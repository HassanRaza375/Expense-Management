// ---------------------------------------------------------------------------
// Reporting logic for transactions (expenses + refunds).
//
// Pure: no Vue, no storage, no imports. Everything is computed from the raw transaction list
// that is passed in, never by adding up other summaries.
//
// DATE RULES
//  * A transaction's day is its LOCAL calendar day: `localDayKey(t.date)` -> 'YYYY-MM-DD'.
//    The user's time zone is applied in exactly two places: `localDayKey` (READ a stored date)
//    and `localNoonISO` (WRITE the date a user picked). Everything else is zone-free calendar
//    arithmetic. localDayKey resolves every kind of stored date to the day the user sees:
//      - NEW date-picker entries, saved as local noon of the chosen day (`localNoonISO`)
//      - OLD date-picker entries, saved as UTC midnight (`new Date('2026-11-02').toISOString()`)
//      - "now" entries (recurring, bills, duplicate), saved as the real instant
//  * Stored dates are never rewritten.
//  * Ranges are inclusive day-key ranges. Day keys compare correctly as strings, so a range
//    end covers its WHOLE last day (no end-of-day timestamp games).
//  * All calendar arithmetic (add days, month length, cycle starts) works on the day keys with
//    UTC-based math, so it is immune to DST and never uses setMonth (which overflows).
//
// MONEY
//  * Amounts are summed as integer cents and returned in currency units, so totals are exact
//    (0.1 + 0.2 === 0.3) and a breakdown always adds up to the summary it came from.
//
// REFUNDS
//  * `kind: 'refund'` (positive amount) reduces net spending. A missing/unknown `kind` is an
//    ordinary expense. This module does NOT affect budget "spent" (useBudget is untouched).
// ---------------------------------------------------------------------------

// ---- day keys (the single local-date helper + pure calendar math) ----------

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n, width) {
  return String(n).padStart(width, '0')
}

function formatKey(y, m, d) {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

/**
 * The local calendar day of a date/ISO string/timestamp as 'YYYY-MM-DD', or null when invalid.
 * The one and only place the user's time zone is applied.
 */
export function localDayKey(value) {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function daysInMonth(year, month) {
  const dt = new Date(0)
  dt.setUTCFullYear(year, month, 0) // day 0 of next month = last day of this month
  return dt.getUTCDate()
}

export function parseDayKey(key) {
  const match = typeof key === 'string' ? DAY_KEY_RE.exec(key) : null
  if (!match) throw new RangeError(`Invalid day "${key}" (expected YYYY-MM-DD)`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new RangeError(`Invalid day "${key}" (not a real calendar date)`)
  return { y, m, d }
}

export function isDayKey(key) {
  try {
    parseDayKey(key)
    return true
  } catch {
    return false
  }
}

// Normalizes overflowing parts (month 13, day 0, day 32...) using pure calendar math.
function keyFromParts(y, m, d) {
  const dt = new Date(0)
  dt.setUTCFullYear(y, m - 1, d)
  return formatKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(key, n) {
  const { y, m, d } = parseDayKey(key)
  return keyFromParts(y, m, d + n)
}

export function diffDays(fromKey, toKey) {
  const a = parseDayKey(fromKey)
  const b = parseDayKey(toKey)
  const ta = Date.UTC(a.y, a.m - 1, a.d)
  const tb = Date.UTC(b.y, b.m - 1, b.d)
  return Math.round((tb - ta) / 86400000)
}

function dayOfWeek(key) {
  const { y, m, d } = parseDayKey(key)
  const dt = new Date(0)
  dt.setUTCFullYear(y, m - 1, d)
  return dt.getUTCDay() // 0 = Sunday
}

// { y, m } shifted by `delta` months, always valid (no overflow).
function shiftMonth(y, m, delta) {
  const total = y * 12 + (m - 1) + delta
  return { y: Math.floor(total / 12), m: (((total % 12) + 12) % 12) + 1 }
}

function formatMonth(y, m) {
  return `${pad(y, 4)}-${pad(m, 2)}`
}

function todayKeyOf(now) {
  const key = localDayKey(now)
  if (key === null) throw new TypeError('Invalid "now" date')
  return key
}

// ---- ranges ----------------------------------------------------------------

// A range is { startKey, endKey }, both inclusive; null means unbounded on that side.

function intersectRanges(a, b) {
  const startKey = a.startKey === null ? b.startKey : b.startKey === null ? a.startKey : a.startKey > b.startKey ? a.startKey : b.startKey
  const endKey = a.endKey === null ? b.endKey : b.endKey === null ? a.endKey : a.endKey < b.endKey ? a.endKey : b.endKey
  if (startKey !== null && endKey !== null && startKey > endKey) return null
  return { startKey, endKey }
}

function inRange(dayKey, range) {
  if (range.startKey !== null && dayKey < range.startKey) return false
  if (range.endKey !== null && dayKey > range.endKey) return false
  return true
}

// ---- periods ---------------------------------------------------------------

/**
 * The ONE place the first day of the week is decided (owner decision: Monday). 0 = Sunday ... 6 = Saturday.
 * Every function that needs it defaults to this constant; pass `weekStartsOn` only to override.
 * NOTE: useExpenses.groupedByWeek (used by the Dashboard trend chart) still starts weeks on Sunday
 * until the Dashboard is moved onto this module in Phase 1.3.
 */
export const WEEK_STARTS_ON = 1

export const PERIOD_IDS = ['this-month', 'last-month', 'this-week', 'last-week', 'this-year', 'previous-year', 'all', 'custom']

function blankToNull(v) {
  return v === undefined || v === null || v === '' ? null : v
}

/**
 * Resolves a period to an inclusive day range.
 * `period` is an id string, or { id: 'custom', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }.
 * Custom: blank start/end are open-ended; start > end are swapped; the end day is fully included;
 * a non-blank malformed day throws RangeError.
 * Weeks start on `weekStartsOn`, which defaults to WEEK_STARTS_ON (Monday).
 */
export function resolvePeriod(period = 'all', { now = new Date(), weekStartsOn = WEEK_STARTS_ON } = {}) {
  const spec = typeof period === 'string' ? { id: period } : period || { id: 'all' }
  const id = spec.id
  if (!PERIOD_IDS.includes(id)) throw new RangeError(`Unknown period "${id}"`)
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) throw new RangeError('weekStartsOn must be 0-6')

  if (id === 'all') return { id, startKey: null, endKey: null }

  if (id === 'custom') {
    let startKey = blankToNull(spec.start)
    let endKey = blankToNull(spec.end)
    if (startKey !== null) parseDayKey(startKey)
    if (endKey !== null) parseDayKey(endKey)
    if (startKey !== null && endKey !== null && startKey > endKey) [startKey, endKey] = [endKey, startKey]
    return { id, startKey, endKey }
  }

  const today = todayKeyOf(now)
  const { y, m } = parseDayKey(today)

  if (id === 'this-month' || id === 'last-month') {
    const target = id === 'this-month' ? { y, m } : shiftMonth(y, m, -1)
    return { id, startKey: formatKey(target.y, target.m, 1), endKey: formatKey(target.y, target.m, daysInMonth(target.y, target.m)) }
  }

  if (id === 'this-year' || id === 'previous-year') {
    const year = id === 'this-year' ? y : y - 1
    return { id, startKey: formatKey(year, 1, 1), endKey: formatKey(year, 12, 31) }
  }

  // weeks
  const back = (dayOfWeek(today) - weekStartsOn + 7) % 7
  const thisWeekStart = addDays(today, -back)
  const startKey = id === 'this-week' ? thisWeekStart : addDays(thisWeekStart, -7)
  return { id, startKey, endKey: addDays(startKey, 6) }
}

// ---- budget cycles ---------------------------------------------------------
//
// Cycles start on `resetDay` of each month; in months shorter than resetDay the cycle starts on
// the month's last day (reset day 31 -> Feb 28/29, Apr 30...). Cycles are contiguous and never
// overlap: each one ends the day before the next starts. For reset days 1-28 this is identical to
// the original getCycle() (kept in scripts/legacy-cycle.mjs); for 29-31 it avoids that function's setMonth overflow.

function assertResetDay(resetDay) {
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) throw new RangeError('resetDay must be an integer from 1 to 31')
}

function cycleStartIn(y, m, resetDay) {
  return formatKey(y, m, Math.min(resetDay, daysInMonth(y, m)))
}

/** The cycle { startKey, endKey } that contains the given day (a day key, Date, or ISO string). */
export function cycleContaining(value, resetDay) {
  assertResetDay(resetDay)
  const dayKey = isDayKey(value) ? value : localDayKey(value)
  if (dayKey === null) throw new TypeError('Invalid date')
  const { y, m } = parseDayKey(dayKey)

  let start = cycleStartIn(y, m, resetDay)
  let startMonth = { y, m }
  if (dayKey < start) {
    startMonth = shiftMonth(y, m, -1)
    start = cycleStartIn(startMonth.y, startMonth.m, resetDay)
  }
  const next = shiftMonth(startMonth.y, startMonth.m, 1)
  return { startKey: start, endKey: addDays(cycleStartIn(next.y, next.m, resetDay), -1) }
}

export function currentCycle(now, resetDay) {
  return cycleContaining(todayKeyOf(now), resetDay)
}

export function previousCycle(now, resetDay) {
  return adjacentCycle(currentCycle(now, resetDay), resetDay, -1)
}

/** The cycle before (-1) or after (+1) the given cycle. */
export function adjacentCycle(cycle, resetDay, direction) {
  return cycleContaining(direction < 0 ? addDays(cycle.startKey, -1) : addDays(cycle.endKey, 1), resetDay)
}

/**
 * Cycles that contain at least one transaction (expenses and refunds), plus the current cycle
 * even when empty, newest first: [{ id, startKey, endKey, count, isCurrent }].
 * Transactions with an unreadable date are skipped.
 */
export function listCycles(transactions, resetDay, now = new Date()) {
  assertResetDay(resetDay)
  const current = currentCycle(now, resetDay)
  const byStart = new Map()
  for (const t of transactions || []) {
    const key = localDayKey(t?.date)
    if (key === null) continue
    const cycle = cycleContaining(key, resetDay)
    const entry = byStart.get(cycle.startKey)
    if (entry) entry.count++
    else byStart.set(cycle.startKey, { ...cycle, count: 1 })
  }
  if (!byStart.has(current.startKey)) byStart.set(current.startKey, { ...current, count: 0 })
  return [...byStart.values()]
    .sort((a, b) => (a.startKey < b.startKey ? 1 : -1))
    .map((c) => ({ id: c.startKey, startKey: c.startKey, endKey: c.endKey, count: c.count, isCurrent: c.startKey === current.startKey }))
}

/**
 * Cycle filter -> range or null (= "all cycles", no constraint).
 * Accepts: null/undefined/'all', 'current', 'previous' (these two need `resetDay`),
 * or a { startKey, endKey } cycle such as one returned by listCycles().
 */
export function resolveCycleFilter(cycle, { now = new Date(), resetDay } = {}) {
  if (cycle === null || cycle === undefined || cycle === 'all') return null
  if (cycle === 'current') return currentCycle(now, resetDay)
  if (cycle === 'previous') return previousCycle(now, resetDay)
  if (typeof cycle === 'object' && isDayKey(cycle.startKey) && isDayKey(cycle.endKey)) {
    if (cycle.startKey > cycle.endKey) throw new RangeError('Cycle start is after its end')
    return { startKey: cycle.startKey, endKey: cycle.endKey }
  }
  throw new TypeError('Unrecognised cycle filter')
}

// ---- filters ---------------------------------------------------------------

/**
 * Combines the period and cycle filters. They are independent and ANDed: the result is the
 * intersection of the two day ranges. `empty: true` means the intersection contains no days.
 * Returns { startKey, endKey, empty, period, cycle } (cycle is null for "all cycles").
 */
export function resolveFilters({ period = 'all', cycle = null, now = new Date(), weekStartsOn = WEEK_STARTS_ON, resetDay } = {}) {
  const resolvedPeriod = resolvePeriod(period, { now, weekStartsOn })
  const resolvedCycle = resolveCycleFilter(cycle, { now, resetDay })
  const cycleRange = resolvedCycle || { startKey: null, endKey: null }
  const range = intersectRanges(resolvedPeriod, cycleRange)
  if (range === null) return { startKey: null, endKey: null, empty: true, period: resolvedPeriod, cycle: resolvedCycle }
  return { startKey: range.startKey, endKey: range.endKey, empty: false, period: resolvedPeriod, cycle: resolvedCycle }
}

/**
 * Filters a transaction list. Never mutates the input; keeps the original order.
 *  - period + cycle: ANDed (see resolveFilters). With no date bound at all, transactions with an
 *    unreadable date are kept; with any bound they are excluded.
 *  - categoryId: null/'all' = every category.
 *  - query: case-insensitive substring of the note OR of the category's name. Category names come
 *    from `categoryNames` (a plain { id: name } object or a Map); without it only notes match.
 *  - accountId (Phase 2): null/'all' = every account; ACCOUNT_NONE ('none') = Unassigned (no accountId, or an id that
 *    is not in `knownAccountIds` when that list is given); anything else = exactly that account. A plain AND.
 */
export const ACCOUNT_NONE = 'none'

export function filterTransactions(
  list,
  { period = 'all', cycle = null, categoryId = null, query = '', categoryNames = null, accountId = null, knownAccountIds = null, now = new Date(), weekStartsOn = WEEK_STARTS_ON, resetDay } = {}
) {
  const range = resolveFilters({ period, cycle, now, weekStartsOn, resetDay })
  if (range.empty) return []
  const bounded = range.startKey !== null || range.endKey !== null
  const q = String(query || '').trim().toLowerCase()
  const wantCategory = categoryId !== null && categoryId !== undefined && categoryId !== 'all'
  const wantAccount = accountId !== null && accountId !== undefined && accountId !== 'all' && accountId !== ''
  const known = knownAccountIds ? new Set(knownAccountIds) : null

  return (list || []).filter((t) => {
    if (bounded) {
      const key = localDayKey(t?.date)
      if (key === null || !inRange(key, range)) return false
    }
    if (wantCategory && t.categoryId !== categoryId) return false
    if (wantAccount) {
      if (accountId === ACCOUNT_NONE) {
        if (t.accountId && (!known || known.has(t.accountId))) return false
      } else if (t.accountId !== accountId) return false
    }
    if (q) {
      const inNote = String(t.note || '').toLowerCase().includes(q)
      if (!inNote && !String(nameOf(categoryNames, t.categoryId) || '').toLowerCase().includes(q)) return false
    }
    return true
  })
}

function nameOf(names, id) {
  if (!names || id === null || id === undefined) return ''
  return names instanceof Map ? names.get(id) ?? '' : names[id] ?? ''
}

// ---- money helpers ---------------------------------------------------------

export function isRefund(t) {
  return t?.kind === 'refund'
}

function toCents(t) {
  const n = Number(t?.amount)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// Positive for expenses, negative for refunds.
function signedCents(t) {
  return isRefund(t) ? -toCents(t) : toCents(t)
}

const fromCents = (c) => c / 100

// ---- summary ---------------------------------------------------------------

function countDays(list, range, today) {
  if (range && range.empty) return 0
  let lo = range?.startKey ?? null
  if (lo === null) {
    for (const t of list) {
      const key = localDayKey(t?.date)
      if (key !== null && (lo === null || key < lo)) lo = key
    }
  }
  if (lo === null) return 0
  const end = range?.endKey ?? null
  const hi = end === null || end > today ? today : end
  return hi < lo ? 0 : diffDays(lo, hi) + 1
}

/**
 * Totals for an (already filtered) list.
 *  gross  = sum of ordinary expenses       refunds = sum of refunds (positive)
 *  net    = gross - refunds (can be negative)
 *  count  = number of transactions (expenses + refunds)
 *  days   = days in the range up to today (future days do not dilute the average)
 *  dailyAverage = net / days (every calendar day counts)
 *  activeDays = distinct local days that have at least one transaction
 *  averagePerActiveDay = net / activeDays (only days you actually spent/refunded on)
 *  largest = the biggest single ORDINARY expense { id, amount, date, categoryId, note }, or null
 *            (refunds are never "largest"; the first one wins a tie)
 * `range` is the result of resolveFilters(); without it the span is first transaction -> today.
 */
export function summarize(list, { range = null, now = new Date() } = {}) {
  const items = list || []
  const today = todayKeyOf(now)
  let grossC = 0
  let refundC = 0
  let expenseCount = 0
  let refundCount = 0
  let largest = null
  let largestC = -Infinity
  const activeDayKeys = new Set()
  for (const t of items) {
    const dayKey = localDayKey(t?.date)
    if (dayKey !== null) activeDayKeys.add(dayKey)
    if (isRefund(t)) {
      refundC += toCents(t)
      refundCount++
    } else {
      const c = toCents(t)
      grossC += c
      expenseCount++
      if (c > largestC) {
        largestC = c
        largest = t
      }
    }
  }
  const netC = grossC - refundC
  const days = countDays(items, range, today)
  const activeDays = activeDayKeys.size
  return {
    count: items.length,
    expenseCount,
    refundCount,
    gross: fromCents(grossC),
    refunds: fromCents(refundC),
    net: fromCents(netC),
    days,
    dailyAverage: days > 0 ? fromCents(Math.round(netC / days)) : 0,
    activeDays,
    averagePerActiveDay: activeDays > 0 ? fromCents(Math.round(netC / activeDays)) : 0,
    largest: largest ? { id: largest.id, amount: fromCents(largestC), date: largest.date, categoryId: largest.categoryId ?? null, note: largest.note || '' } : null,
  }
}

/**
 * Per-category totals, largest net first. The category nets always add up to summarize().net of
 * the same list. `share` is the category's percentage of the combined spending of all categories
 * that have a positive net (so shares of a donut chart always add up to 100); categories whose
 * net is zero or negative (refunds exceed spending) have share 0.
 */
export function categoryBreakdown(list) {
  const groups = new Map()
  for (const t of list || []) {
    const id = t?.categoryId ?? null
    let g = groups.get(id)
    if (!g) {
      g = { categoryId: id, grossC: 0, refundC: 0, count: 0 }
      groups.set(id, g)
    }
    if (isRefund(t)) g.refundC += toCents(t)
    else g.grossC += toCents(t)
    g.count++
  }
  let positiveC = 0
  for (const g of groups.values()) positiveC += Math.max(g.grossC - g.refundC, 0)

  return [...groups.values()]
    .map((g) => {
      const netC = g.grossC - g.refundC
      return {
        categoryId: g.categoryId,
        gross: fromCents(g.grossC),
        refunds: fromCents(g.refundC),
        net: fromCents(netC),
        count: g.count,
        share: netC > 0 ? (netC / positiveC) * 100 : 0,
      }
    })
    .sort((a, b) => b.net - a.net || String(a.categoryId).localeCompare(String(b.categoryId)))
}

// ---- grouping --------------------------------------------------------------

function createdMs(t) {
  const ms = new Date(t?.createdAt).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Groups by LOCAL day with a net subtotal per day: [{ dayKey, items, count, net }].
 * order 'newest' (default): newest day first, and within a day the most recently created first.
 * order 'oldest': oldest day first, and within a day the earliest created first.
 * Transactions with an unreadable date go in a final { dayKey: null } group so no money vanishes.
 */
export function groupByDay(list, { order = 'newest' } = {}) {
  if (order !== 'newest' && order !== 'oldest') throw new RangeError(`Unknown order "${order}"`)
  const dir = order === 'newest' ? -1 : 1
  const groups = new Map()
  for (const t of list || []) {
    const key = localDayKey(t?.date)
    let g = groups.get(key)
    if (!g) {
      g = { dayKey: key, items: [], netC: 0 }
      groups.set(key, g)
    }
    g.items.push(t)
    g.netC += signedCents(t)
  }
  return [...groups.values()]
    .sort((a, b) => (a.dayKey === null ? 1 : b.dayKey === null ? -1 : a.dayKey < b.dayKey ? -dir : dir))
    .map((g) => ({
      dayKey: g.dayKey,
      items: g.items.slice().sort((a, b) => -dir * (createdMs(b) - createdMs(a))),
      count: g.items.length,
      net: fromCents(g.netC),
    }))
}

// ---- sorting ---------------------------------------------------------------

export const SORT_MODES = ['newest', 'oldest', 'highest', 'lowest']

/**
 * Returns a NEW sorted array.
 *  newest / oldest: by local day, then by when it was entered. Unreadable dates always last.
 *  highest / lowest: by amount (refunds count by their positive amount, same as expenses);
 *                    ties are broken newest first.
 */
export function sortTransactions(list, mode = 'newest') {
  if (!SORT_MODES.includes(mode)) throw new RangeError(`Unknown sort "${mode}"`)
  const items = (list || []).map((t) => ({ t, day: localDayKey(t?.date), c: toCents(t), ms: createdMs(t) }))
  const byDate = (a, b, dir) => {
    if (a.day === b.day) return dir * (a.ms - b.ms)
    if (a.day === null) return 1
    if (b.day === null) return -1
    return a.day < b.day ? -dir : dir
  }
  items.sort((a, b) => {
    if (mode === 'newest') return byDate(a, b, -1)
    if (mode === 'oldest') return byDate(a, b, 1)
    const diff = mode === 'highest' ? b.c - a.c : a.c - b.c
    return diff || byDate(a, b, -1)
  })
  return items.map((x) => x.t)
}

// ---- stored dates (the write side of localDayKey) --------------------------

/**
 * The value to STORE for a day the user picked: noon of that day in the user's local zone, as an
 * ISO string. Noon is far from every midnight and DST change, so the stored instant can never
 * drift onto a neighbouring day, in any zone. (Older records were saved as UTC midnight; those
 * are left alone and still read correctly through localDayKey in zones at or ahead of UTC.)
 */
export function localNoonISO(dayKey) {
  const { y, m, d } = parseDayKey(dayKey)
  const dt = new Date(0)
  dt.setFullYear(y, m - 1, d)
  dt.setHours(12, 0, 0, 0)
  return dt.toISOString()
}

/**
 * What to store when saving a form: if the user did not change the day, keep the record's
 * existing `date` untouched (never rewrite stored dates just because a note was edited);
 * otherwise store local noon of the new day.
 */
export function resolveSavedDate(originalDate, dayKey) {
  if (originalDate && localDayKey(originalDate) === dayKey) return originalDate
  return localNoonISO(dayKey)
}

// ---- plain-words descriptions ----------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const PERIOD_LABELS = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-week': 'This week',
  'last-week': 'Last week',
  'this-year': 'This year',
  'previous-year': 'Previous year',
  all: 'All time',
  custom: 'Custom range',
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** '2026-11-06' -> '6 Nov 2026'; { weekday: true } -> 'Fri 6 Nov 2026'; { year: false } -> '6 Nov' */
export function formatDayKey(key, { weekday = false, year = true } = {}) {
  const { y, m, d } = parseDayKey(key)
  const text = year ? `${d} ${MONTH_NAMES[m - 1]} ${y}` : `${d} ${MONTH_NAMES[m - 1]}`
  return weekday ? `${WEEKDAY_NAMES[dayOfWeek(key)]} ${text}` : text
}

/** A cycle as '6 Nov – 5 Dec 2026' (years shown on both ends when they differ). */
export function cycleLabel(cycle) {
  const a = parseDayKey(cycle.startKey)
  const b = parseDayKey(cycle.endKey)
  const left = a.y === b.y ? `${a.d} ${MONTH_NAMES[a.m - 1]}` : formatDayKey(cycle.startKey)
  return `${left} – ${formatDayKey(cycle.endKey)}`
}

/** The range in words: 'from 6 Nov 2026 to 5 Dec 2026', 'on 6 Nov 2026', 'from any date', ... */
export function describeRange(range) {
  if (range.empty) return 'for no days at all (the period and the cycle do not overlap)'
  const { startKey, endKey } = range
  if (startKey === null && endKey === null) return 'from any date'
  if (startKey === null) return `up to ${formatDayKey(endKey)}`
  if (endKey === null) return `from ${formatDayKey(startKey)} onwards`
  if (startKey === endKey) return `on ${formatDayKey(startKey)}`
  return `from ${formatDayKey(startKey)} to ${formatDayKey(endKey)}`
}

/**
 * Describes the active filters in plain words.
 * `resolved` = resolveFilters(...) result; `selection` = the raw choices
 * ({ period, cycle, categoryId, query }); `categoryLabel` = display name for categoryId.
 * Returns { sentence, range, parts }: `parts` lists only the filters that are actually narrowing
 * the list (e.g. ['This month', 'Current cycle (6 Nov – 5 Dec 2026)', 'Category: Food', 'Search: "lunch"']).
 */
export function describeFilters(resolved, { period = 'all', cycle = null, categoryId = null, query = '', categoryLabel = null } = {}) {
  const parts = []
  const periodId = typeof period === 'string' ? period : period?.id
  if (periodId && periodId !== 'all') parts.push(PERIOD_LABELS[periodId] || periodId)

  if (cycle === 'current' && resolved.cycle) parts.push(`Current cycle (${cycleLabel(resolved.cycle)})`)
  else if (cycle === 'previous' && resolved.cycle) parts.push(`Previous cycle (${cycleLabel(resolved.cycle)})`)
  else if (resolved.cycle) parts.push(`Cycle ${cycleLabel(resolved.cycle)}`)

  if (categoryId !== null && categoryId !== undefined && categoryId !== 'all') parts.push(`Category: ${categoryLabel || categoryId}`)
  const q = String(query || '').trim()
  if (q) parts.push(`Search: "${q}"`)

  const range = describeRange(resolved)
  return { sentence: `Showing transactions ${range}`, range, parts }
}

// ---- CSV export ------------------------------------------------------------

function csvCell(value) {
  let s = String(value ?? '')
  // Spreadsheet formula injection: a cell starting with = + - @ (or a control char) can run as a
  // formula when the file is opened in Excel/Sheets. A leading apostrophe makes it plain text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV text for a list of transactions (RFC 4180: CRLF line ends, quoted when needed).
 * Columns: date (local day), amount (always positive), kind (expense|refund), category (NAME),
 * note, source, account (NAME; blank when the record has no account). Pass the list you want exported, e.g. the
 * currently filtered one.
 * `categoryNames` maps id -> name; an id with no entry is exported as "(deleted category)".
 * `accountNames` maps account id -> name; an accountId with no entry is exported as "(deleted account)".
 */
export function transactionsToCsv(list, { categoryNames = null, accountNames = null } = {}) {
  const rows = [['date', 'amount', 'kind', 'category', 'note', 'source', 'account']]
  for (const t of list || []) {
    const id = t?.categoryId
    const name = id === null || id === undefined ? '' : nameOf(categoryNames, id) || '(deleted category)'
    const aid = t?.accountId
    const account = aid === null || aid === undefined || aid === '' ? '' : nameOf(accountNames, aid) || '(deleted account)'
    rows.push([localDayKey(t?.date) ?? '', (toCents(t) / 100).toFixed(2), isRefund(t) ? 'refund' : 'expense', name, t?.note || '', t?.source || '', account])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ---- month comparison ------------------------------------------------------

function compare(currentC, previousC) {
  const change = currentC - previousC
  return {
    current: fromCents(currentC),
    previous: fromCents(previousC),
    change: fromCents(change),
    // null (not 100%) when there is nothing positive to compare against
    changePct: previousC > 0 ? (change / previousC) * 100 : null,
  }
}

/**
 * Current calendar month vs the previous one, computed from the raw list (apply any category
 * filter to the list first; do not pass a period/cycle-filtered list unless that is intended).
 *
 *  monthToDate: this month's day 1..today vs the same span (first N days) of last month.
 *               If last month is shorter than N the whole of last month is used
 *               (previousSpanClamped: true).
 *  fullMonth:   this month so far vs the whole of last month. Not like-for-like until the month
 *               is over: currentIsComplete says whether it is.
 *  byCategory:  both comparisons per category.
 * Percent changes are null when the previous figure is zero or negative.
 */
export function compareMonths(list, { now = new Date() } = {}) {
  const today = todayKeyOf(now)
  const { y, m, d } = parseDayKey(today)
  const prev = shiftMonth(y, m, -1)
  const prevDays = daysInMonth(prev.y, prev.m)
  const spanDays = Math.min(d, prevDays)

  const ranges = {
    curToDate: { startKey: formatKey(y, m, 1), endKey: today },
    prevToDate: { startKey: formatKey(prev.y, prev.m, 1), endKey: formatKey(prev.y, prev.m, spanDays) },
    curFull: { startKey: formatKey(y, m, 1), endKey: formatKey(y, m, daysInMonth(y, m)) },
    prevFull: { startKey: formatKey(prev.y, prev.m, 1), endKey: formatKey(prev.y, prev.m, prevDays) },
  }
  const names = Object.keys(ranges)
  const zero = () => ({ curToDate: 0, prevToDate: 0, curFull: 0, prevFull: 0 })

  const totals = zero()
  const perCategory = new Map()
  for (const t of list || []) {
    const key = localDayKey(t?.date)
    if (key === null) continue
    const cents = signedCents(t)
    const id = t?.categoryId ?? null
    for (const name of names) {
      if (!inRange(key, ranges[name])) continue
      totals[name] += cents
      let c = perCategory.get(id)
      if (!c) {
        c = zero()
        perCategory.set(id, c)
      }
      c[name] += cents
    }
  }

  const shape = (s) => ({
    monthToDate: compare(s.curToDate, s.prevToDate),
    fullMonth: { ...compare(s.curFull, s.prevFull), currentIsComplete: today >= ranges.curFull.endKey },
  })

  return {
    currentMonth: formatMonth(y, m),
    previousMonth: formatMonth(prev.y, prev.m),
    daysElapsed: d,
    previousSpanDays: spanDays,
    previousSpanClamped: spanDays < d,
    ...shape(totals),
    byCategory: [...perCategory.entries()]
      .map(([categoryId, s]) => ({ categoryId, ...shape(s) }))
      .sort((a, b) => b.monthToDate.current - a.monthToDate.current || b.fullMonth.current - a.fullMonth.current || String(a.categoryId).localeCompare(String(b.categoryId))),
  }
}

// ---- day-in-range + chart series -------------------------------------------

/** True when the LOCAL day of `value` lies inside the inclusive { startKey, endKey } range (null = open). */
export function dayInRange(value, range) {
  const key = localDayKey(value)
  return key !== null && inRange(key, range)
}

/** Day key of the first day of the week that contains `dayKey` (default: Monday, see WEEK_STARTS_ON). */
export function weekStartOf(dayKey, weekStartsOn = WEEK_STARTS_ON) {
  return addDays(dayKey, -((dayOfWeek(dayKey) - weekStartsOn + 7) % 7))
}

// Net (expenses minus refunds) per bucket, as integer cents. Transactions with an unreadable date
// have no day, so they cannot appear on a chart (they still count in totals computed from the list).
function netCentsBy(list, bucketOf) {
  const totals = new Map()
  for (const t of list || []) {
    const day = localDayKey(t?.date)
    if (day === null) continue
    const key = bucketOf(day)
    totals.set(key, (totals.get(key) || 0) + signedCents(t))
  }
  return totals
}

const byKeyAsc = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

/** [{ date: 'YYYY-MM-DD', total }] oldest first, one entry per local day that has transactions. */
export function dailySeries(list) {
  return [...netCentsBy(list, (day) => day)].sort(byKeyAsc).map(([date, c]) => ({ date, total: fromCents(c) }))
}

/** [{ date: <first day of the week>, total }] oldest first, weeks that have transactions. */
export function weeklySeries(list, { weekStartsOn = WEEK_STARTS_ON } = {}) {
  return [...netCentsBy(list, (day) => weekStartOf(day, weekStartsOn))].sort(byKeyAsc).map(([date, c]) => ({ date, total: fromCents(c) }))
}

/**
 * The last `months` calendar months ending with the current one, oldest first, INCLUDING months with
 * no transactions (total 0): [{ date: 'YYYY-MM-01', total }].
 */
export function monthlySeries(list, { months = 6, now = new Date() } = {}) {
  const { y, m } = parseDayKey(todayKeyOf(now))
  const totals = netCentsBy(list, (day) => {
    const p = parseDayKey(day)
    return formatMonth(p.y, p.m)
  })
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const t = shiftMonth(y, m, -i)
    const key = formatMonth(t.y, t.m)
    out.push({ date: `${key}-01`, total: fromCents(totals.get(key) || 0) })
  }
  return out
}
