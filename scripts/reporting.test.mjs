// Tests for src/utils/reporting.js
//   npm test        -> runs in the machine's time zone
//   npm run test:tz -> runs this file under UTC, Asia/Karachi, America/New_York, Pacific/Auckland
//
// Fixtures come in two flavours, exactly like real stored data:
//   local(...)  a real instant at a LOCAL clock time (what "now"-style entries store)
//   picked(...) the date-picker format: new Date('YYYY-MM-DD').toISOString() = UTC midnight
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  localDayKey,
  parseDayKey,
  isDayKey,
  addDays,
  diffDays,
  daysInMonth,
  resolvePeriod,
  cycleContaining,
  currentCycle,
  previousCycle,
  adjacentCycle,
  listCycles,
  resolveCycleFilter,
  resolveFilters,
  filterTransactions,
  isRefund,
  summarize,
  categoryBreakdown,
  groupByDay,
  compareMonths,
  WEEK_STARTS_ON,
  SORT_MODES,
  sortTransactions,
  localNoonISO,
  resolveSavedDate,
  formatDayKey,
  cycleLabel,
  describeRange,
  describeFilters,
  PERIOD_LABELS,
  transactionsToCsv,
} from '../src/utils/reporting.js'
import { getCycle } from './legacy-cycle.mjs'

// ---- fixtures --------------------------------------------------------------

let seq = 0
const local = (y, m, d, h = 12, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s).toISOString()
const picked = (key) => new Date(key).toISOString()
const NOW = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi)
const tx = (date, amount, extra = {}) => ({
  id: `t${++seq}`,
  date,
  amount,
  categoryId: 'food',
  note: '',
  createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
  ...extra,
})
const refund = (date, amount, extra = {}) => tx(date, amount, { kind: 'refund', ...extra })
const ids = (list) => list.map((t) => t.id).sort()
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.values(o).forEach(deepFreeze)
  }
  return o
}

// The picker format only lands on the intended local day in zones at or ahead of UTC (the app's
// own edit form has the same property). Tests that rely on it are skipped elsewhere.
const pickerSafe = new Date('2026-11-02').getTimezoneOffset() <= 0
const pickerOpts = { skip: pickerSafe ? false : 'date-picker (UTC midnight) entries shift a day in zones behind UTC; documented in HISAAB_PROGRESS.md' }

// ---- the zone under test must be the zone we asked for ---------------------

test('time zone under test is the requested one', { skip: process.env.EXPECT_TZ_OFFSET === undefined && 'no EXPECT_TZ_OFFSET (machine zone run)' }, () => {
  assert.equal(new Date(2026, 10, 15, 12).getTimezoneOffset(), Number(process.env.EXPECT_TZ_OFFSET), `TZ=${process.env.TZ} did not take effect`)
})

// ---- localDayKey ------------------------------------------------------------

test('localDayKey: "now"-style instants resolve to the local day, including just after midnight', () => {
  assert.equal(localDayKey(local(2026, 11, 2, 0, 5)), '2026-11-02')
  assert.equal(localDayKey(local(2026, 11, 2, 23, 59, 59)), '2026-11-02')
  assert.equal(localDayKey(local(2026, 10, 31, 23, 59)), '2026-10-31')
})

test('localDayKey: last day / first day of a month are never shifted into the neighbour month', () => {
  // 00:30 local on the 1st is still the previous UTC day in zones ahead of UTC; slicing the ISO
  // string would put this in October.
  assert.equal(localDayKey(local(2026, 11, 1, 0, 30)), '2026-11-01')
  assert.equal(localDayKey(local(2026, 12, 31, 23, 30)), '2026-12-31')
  assert.equal(localDayKey(local(2027, 1, 1, 0, 1)), '2027-01-01')
})

test('localDayKey: date-picker entries (UTC midnight) resolve to the picked day', pickerOpts, () => {
  assert.equal(localDayKey(picked('2026-11-02')), '2026-11-02')
  assert.equal(localDayKey(picked('2026-02-28')), '2026-02-28')
  assert.equal(localDayKey(picked('2026-12-31')), '2026-12-31')
})

test('localDayKey: DST change days resolve correctly', () => {
  assert.equal(localDayKey(local(2026, 11, 1, 23, 30)), '2026-11-01') // US fall back
  assert.equal(localDayKey(local(2026, 3, 8, 23, 30)), '2026-03-08') // US spring forward
  assert.equal(localDayKey(local(2026, 3, 29, 23, 30)), '2026-03-29') // EU spring forward
})

test('localDayKey: accepts Date and timestamp, returns null for anything unreadable', () => {
  assert.equal(localDayKey(new Date(2026, 5, 15, 8)), '2026-06-15')
  assert.equal(localDayKey(new Date(2026, 5, 15, 8).getTime()), '2026-06-15')
  for (const bad of ['', null, undefined, 'garbage', NaN, new Date('x')]) assert.equal(localDayKey(bad), null, String(bad))
})

// ---- calendar helpers -------------------------------------------------------

test('day keys: parse/validate and calendar math', () => {
  assert.deepEqual(parseDayKey('2028-02-29'), { y: 2028, m: 2, d: 29 })
  for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', 20260101, null, '']) {
    assert.throws(() => parseDayKey(bad), RangeError, String(bad))
    assert.equal(isDayKey(bad), false)
  }
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2027-01-01', -1), '2026-12-31')
  assert.equal(addDays('2026-03-31', -31), '2026-02-28')
  assert.equal(diffDays('2026-11-01', '2026-11-15'), 14)
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1)
  assert.equal(diffDays('2026-11-15', '2026-11-01'), -14)
  assert.deepEqual(
    [daysInMonth(2026, 2), daysInMonth(2028, 2), daysInMonth(2100, 2), daysInMonth(2000, 2), daysInMonth(2026, 4), daysInMonth(2026, 12)],
    [28, 29, 28, 29, 30, 31]
  )
})

// ---- periods ----------------------------------------------------------------

const range = (p) => [p.startKey, p.endKey]

test('periods: this/last month, including February and year rollover', () => {
  assert.deepEqual(range(resolvePeriod('this-month', { now: NOW(2026, 11, 15) })), ['2026-11-01', '2026-11-30'])
  assert.deepEqual(range(resolvePeriod('last-month', { now: NOW(2026, 11, 15) })), ['2026-10-01', '2026-10-31'])
  assert.deepEqual(range(resolvePeriod('last-month', { now: NOW(2027, 1, 15) })), ['2026-12-01', '2026-12-31'])
  assert.deepEqual(range(resolvePeriod('last-month', { now: NOW(2026, 3, 31) })), ['2026-02-01', '2026-02-28'])
  assert.deepEqual(range(resolvePeriod('last-month', { now: NOW(2028, 3, 1) })), ['2028-02-01', '2028-02-29'])
  assert.deepEqual(range(resolvePeriod('this-month', { now: NOW(2028, 2, 10) })), ['2028-02-01', '2028-02-29'])
})

test('periods: this/previous year', () => {
  assert.deepEqual(range(resolvePeriod('this-year', { now: NOW(2026, 11, 15) })), ['2026-01-01', '2026-12-31'])
  assert.deepEqual(range(resolvePeriod('previous-year', { now: NOW(2026, 11, 15) })), ['2025-01-01', '2025-12-31'])
  assert.deepEqual(range(resolvePeriod('previous-year', { now: NOW(2027, 1, 1, 0, 1) })), ['2026-01-01', '2026-12-31'])
})

test('weeks start on Monday by default, from one constant', () => {
  assert.equal(WEEK_STARTS_ON, 1)
  // 2026-11-15 is a Sunday: with Monday-first weeks it is the LAST day of its week, not the first
  assert.deepEqual(range(resolvePeriod('this-week', { now: NOW(2026, 11, 15) })), ['2026-11-09', '2026-11-15'])
  assert.deepEqual(range(resolvePeriod('last-week', { now: NOW(2026, 11, 15) })), ['2026-11-02', '2026-11-08'])
  // 2026-11-16 is a Monday: it starts a new week
  assert.deepEqual(range(resolvePeriod('this-week', { now: NOW(2026, 11, 16, 0, 5) })), ['2026-11-16', '2026-11-22'])
  assert.deepEqual(range(resolvePeriod('this-week', { now: NOW(2026, 11, 18) })), ['2026-11-16', '2026-11-22'])
  // the default is applied by every caller that takes a period
  const viaDefault = resolveFilters({ period: 'this-week', now: NOW(2026, 11, 15) })
  assert.deepEqual([viaDefault.startKey, viaDefault.endKey], ['2026-11-09', '2026-11-15'])
  const sun = tx(local(2026, 11, 15, 10), 1)
  const mon = tx(local(2026, 11, 16, 10), 1)
  assert.deepEqual(ids(filterTransactions([sun, mon], { period: 'this-week', now: NOW(2026, 11, 15) })), ids([sun]))
  assert.deepEqual(ids(filterTransactions([sun, mon], { period: 'this-week', now: NOW(2026, 11, 16) })), ids([mon]))
})

test('periods: weeks across a year boundary, and an explicit Sunday override', () => {
  // 2026-01-01 is a Thursday
  assert.deepEqual(range(resolvePeriod('this-week', { now: NOW(2026, 1, 1) })), ['2025-12-29', '2026-01-04'])
  assert.deepEqual(range(resolvePeriod('last-week', { now: NOW(2026, 1, 1) })), ['2025-12-22', '2025-12-28'])
  assert.deepEqual(range(resolvePeriod('this-week', { now: NOW(2026, 1, 1), weekStartsOn: 0 })), ['2025-12-28', '2026-01-03'])
  assert.deepEqual(range(resolvePeriod('last-week', { now: NOW(2026, 1, 1), weekStartsOn: 0 })), ['2025-12-21', '2025-12-27'])
  assert.deepEqual(range(resolvePeriod('this-week', { now: NOW(2026, 11, 15), weekStartsOn: 0 })), ['2026-11-15', '2026-11-21'])
  assert.deepEqual(range(resolvePeriod('last-week', { now: NOW(2026, 11, 15), weekStartsOn: 0 })), ['2026-11-08', '2026-11-14'])
})

test('periods: the time of day of "now" never changes the result', () => {
  for (const id of ['this-month', 'last-month', 'this-week', 'last-week', 'this-year', 'previous-year']) {
    assert.deepEqual(resolvePeriod(id, { now: NOW(2026, 11, 15, 0, 1) }), resolvePeriod(id, { now: NOW(2026, 11, 15, 23, 59) }), id)
  }
})

test('periods: all time, and custom (open ends, swapped, malformed, unknown)', () => {
  assert.deepEqual(range(resolvePeriod('all')), [null, null])
  assert.deepEqual(range(resolvePeriod({ id: 'custom', start: '2026-11-03', end: '2026-11-09' })), ['2026-11-03', '2026-11-09'])
  assert.deepEqual(range(resolvePeriod({ id: 'custom', start: '2026-11-09', end: '2026-11-03' })), ['2026-11-03', '2026-11-09'])
  assert.deepEqual(range(resolvePeriod({ id: 'custom', start: '2026-11-03' })), ['2026-11-03', null])
  assert.deepEqual(range(resolvePeriod({ id: 'custom', start: '', end: '2026-11-09' })), [null, '2026-11-09'])
  assert.deepEqual(range(resolvePeriod({ id: 'custom' })), [null, null])
  assert.throws(() => resolvePeriod({ id: 'custom', start: '11/03/2026' }), RangeError)
  assert.throws(() => resolvePeriod({ id: 'custom', end: '2026-02-30' }), RangeError)
  assert.throws(() => resolvePeriod('last-decade'), RangeError)
  assert.throws(() => resolvePeriod('this-week', { weekStartsOn: 7 }), RangeError)
})

// ---- cycles -----------------------------------------------------------------

const cyc = (value, r) => {
  const c = cycleContaining(value, r)
  return [c.startKey, c.endKey]
}

test('cycles: default reset day 6 around the boundary and year rollover', () => {
  assert.deepEqual(cyc('2026-11-15', 6), ['2026-11-06', '2026-12-05'])
  assert.deepEqual(cyc('2026-11-06', 6), ['2026-11-06', '2026-12-05'])
  assert.deepEqual(cyc('2026-11-05', 6), ['2026-10-06', '2026-11-05'])
  assert.deepEqual(cyc('2026-12-06', 6), ['2026-12-06', '2027-01-05'])
  assert.deepEqual(cyc('2027-01-03', 6), ['2026-12-06', '2027-01-05'])
  assert.deepEqual(cyc('2026-02-10', 6), ['2026-02-06', '2026-03-05'])
  assert.deepEqual(cyc('2028-03-05', 6), ['2028-02-06', '2028-03-05'])
})

test('cycles: a cycle accepts a local instant, not only a day key', () => {
  assert.deepEqual(cyc(local(2026, 11, 6, 0, 1), 6), ['2026-11-06', '2026-12-05'])
  assert.deepEqual(cyc(local(2026, 11, 5, 23, 59), 6), ['2026-10-06', '2026-11-05'])
})

test('cycles: reset day 1 is the calendar month', () => {
  assert.deepEqual(cyc('2026-11-15', 1), ['2026-11-01', '2026-11-30'])
  assert.deepEqual(cyc('2028-02-29', 1), ['2028-02-01', '2028-02-29'])
  assert.deepEqual(cyc('2026-12-31', 1), ['2026-12-01', '2026-12-31'])
})

test('cycles: reset day 28', () => {
  assert.deepEqual(cyc('2026-02-28', 28), ['2026-02-28', '2026-03-27'])
  assert.deepEqual(cyc('2026-02-27', 28), ['2026-01-28', '2026-02-27'])
  assert.deepEqual(cyc('2028-02-29', 28), ['2028-02-28', '2028-03-27'])
})

test('cycles: reset day 29 in short months (no overflow)', () => {
  assert.deepEqual(cyc('2026-02-27', 29), ['2026-01-29', '2026-02-27'])
  assert.deepEqual(cyc('2026-02-28', 29), ['2026-02-28', '2026-03-28']) // Feb has no 29th: starts on the 28th
  assert.deepEqual(cyc('2026-03-01', 29), ['2026-02-28', '2026-03-28'])
  assert.deepEqual(cyc('2026-03-29', 29), ['2026-03-29', '2026-04-28'])
  assert.deepEqual(cyc('2028-02-28', 29), ['2028-01-29', '2028-02-28']) // leap year
  assert.deepEqual(cyc('2028-02-29', 29), ['2028-02-29', '2028-03-28'])
})

test('cycles: reset day 31 follows month lengths and never overlaps or skips', () => {
  assert.deepEqual(cyc('2026-01-31', 31), ['2026-01-31', '2026-02-27'])
  assert.deepEqual(cyc('2026-02-28', 31), ['2026-02-28', '2026-03-30'])
  assert.deepEqual(cyc('2026-03-31', 31), ['2026-03-31', '2026-04-29'])
  assert.deepEqual(cyc('2026-04-30', 31), ['2026-04-30', '2026-05-30'])
  assert.deepEqual(cyc('2026-05-31', 31), ['2026-05-31', '2026-06-29'])
  assert.deepEqual(cyc('2026-12-31', 31), ['2026-12-31', '2027-01-30'])
  assert.deepEqual(cyc('2027-01-31', 31), ['2027-01-31', '2027-02-27'])
  assert.deepEqual(cyc('2028-02-29', 31), ['2028-02-29', '2028-03-30'])
})

test('cycles: every day belongs to exactly one contiguous cycle (all reset days, 2024-2028)', () => {
  for (let r = 1; r <= 31; r++) {
    let day = '2024-01-01'
    while (day <= '2028-12-31') {
      const c = cycleContaining(day, r)
      assert.ok(c.startKey <= day && day <= c.endKey, `r=${r} ${day} not inside ${c.startKey}..${c.endKey}`)
      const startMonth = parseDayKey(c.startKey)
      assert.equal(startMonth.d, Math.min(r, daysInMonth(startMonth.y, startMonth.m)), `r=${r} bad start ${c.startKey}`)
      const next = cycleContaining(addDays(c.endKey, 1), r)
      assert.equal(next.startKey, addDays(c.endKey, 1), `r=${r} gap/overlap after ${c.endKey}`)
      assert.deepEqual(cycleContaining(c.startKey, r), c)
      assert.deepEqual(cycleContaining(c.endKey, r), c)
      day = addDays(day, 1)
    }
  }
})

test('cycles: identical to getCycle() in utils/date.js for reset days 1-28 (Dashboard/Budget stay in agreement)', () => {
  for (let r = 1; r <= 28; r++) {
    for (let k = 0; k < 4 * 366; k += 3) {
      const date = new Date(2025, 0, 1 + k, 12)
      const old = getCycle(date, r)
      const mine = cycleContaining(localDayKey(date), r)
      assert.equal(mine.startKey, localDayKey(old.start), `r=${r} ${localDayKey(date)} start`)
      assert.equal(mine.endKey, localDayKey(old.end), `r=${r} ${localDayKey(date)} end`)
    }
  }
})

test('cycles: invalid reset day is rejected', () => {
  for (const bad of [0, 32, 6.5, '6', null, undefined, NaN]) assert.throws(() => cycleContaining('2026-11-15', bad), RangeError, String(bad))
})

test('cycles: current / previous / adjacent', () => {
  assert.deepEqual(currentCycle(NOW(2026, 11, 15), 6), { startKey: '2026-11-06', endKey: '2026-12-05' })
  assert.deepEqual(previousCycle(NOW(2026, 11, 15), 6), { startKey: '2026-10-06', endKey: '2026-11-05' })
  assert.deepEqual(previousCycle(NOW(2027, 1, 3), 6), { startKey: '2026-11-06', endKey: '2026-12-05' })
  const c = currentCycle(NOW(2026, 11, 15), 6)
  assert.deepEqual(adjacentCycle(c, 6, 1), { startKey: '2026-12-06', endKey: '2027-01-05' })
  assert.deepEqual(adjacentCycle(c, 6, -1), { startKey: '2026-10-06', endKey: '2026-11-05' })
  assert.deepEqual(previousCycle(NOW(2026, 3, 31), 31), { startKey: '2026-02-28', endKey: '2026-03-30' })
})

test('listCycles: cycles with data + the current cycle, newest first, with counts', () => {
  const list = [
    tx(local(2026, 10, 31, 23, 59), 10), // cycle Oct 6 - Nov 5
    tx(local(2026, 11, 5, 23, 59), 10), // same cycle
    tx(local(2026, 11, 6, 0, 0), 10), // cycle Nov 6 - Dec 5 (current)
    refund(local(2026, 8, 20), 5), // cycle Aug 6 - Sep 5
    tx('garbage', 10), // skipped
  ]
  const cycles = listCycles(list, 6, NOW(2026, 11, 15))
  assert.deepEqual(
    cycles.map((c) => [c.startKey, c.endKey, c.count, c.isCurrent]),
    [
      ['2026-11-06', '2026-12-05', 1, true],
      ['2026-10-06', '2026-11-05', 2, false],
      ['2026-08-06', '2026-09-05', 1, false],
    ]
  )
  assert.equal(cycles[0].id, '2026-11-06')
})

test('listCycles: empty data still offers the current cycle; an empty current cycle is added', () => {
  assert.deepEqual(listCycles([], 6, NOW(2026, 11, 15)), [{ id: '2026-11-06', startKey: '2026-11-06', endKey: '2026-12-05', count: 0, isCurrent: true }])
  assert.deepEqual(listCycles(null, 6, NOW(2026, 11, 15)).length, 1)
  const old = [tx(local(2025, 1, 20), 5)]
  const cycles = listCycles(old, 6, NOW(2026, 11, 15))
  assert.equal(cycles.length, 2)
  assert.equal(cycles[0].isCurrent, true)
  assert.equal(cycles[0].count, 0)
})

test('resolveCycleFilter: all / current / previous / explicit cycle / bad input', () => {
  const opts = { now: NOW(2026, 11, 15), resetDay: 6 }
  assert.equal(resolveCycleFilter(null, opts), null)
  assert.equal(resolveCycleFilter('all', opts), null)
  assert.deepEqual(resolveCycleFilter('current', opts), { startKey: '2026-11-06', endKey: '2026-12-05' })
  assert.deepEqual(resolveCycleFilter('previous', opts), { startKey: '2026-10-06', endKey: '2026-11-05' })
  assert.deepEqual(resolveCycleFilter({ startKey: '2026-01-06', endKey: '2026-02-05', count: 9 }, opts), { startKey: '2026-01-06', endKey: '2026-02-05' })
  assert.throws(() => resolveCycleFilter('current', { now: NOW(2026, 11, 15) }), RangeError) // needs resetDay
  assert.throws(() => resolveCycleFilter({ startKey: '2026-02-05', endKey: '2026-01-06' }, opts), RangeError)
  assert.throws(() => resolveCycleFilter('whatever', opts), TypeError)
})

// ---- filterTransactions -----------------------------------------------------

// Spread across cycle (Oct 6 - Nov 5 | Nov 6 - Dec 5) and month boundaries, at awkward times.
const A = tx(local(2026, 10, 31, 23, 59), 10, { note: 'A' })
const B = tx(local(2026, 11, 1, 0, 30), 20, { note: 'B' })
const C = tx(local(2026, 11, 5, 23, 59), 30, { note: 'C' })
const D = tx(local(2026, 11, 6, 0, 0), 40, { note: 'D' })
const E = tx(local(2026, 11, 15, 12, 0), 50, { note: 'E' })
const F = tx(local(2026, 11, 30, 23, 30), 60, { note: 'F' })
const G = tx(local(2026, 12, 1, 0, 15), 70, { note: 'G' })
const H = tx(local(2026, 10, 5, 12, 0), 80, { note: 'H' })
const FIXED = [A, B, C, D, E, F, G, H]
const names = (list) => list.map((t) => t.note).sort().join('')
const filtNames = (opts) => names(filterTransactions(FIXED, { now: NOW(2026, 11, 15), resetDay: 6, ...opts }))

test('filter: period and cycle are independent and ANDed', () => {
  const nov = { period: 'this-month' }
  assert.equal(filtNames({ ...nov, cycle: 'all' }), 'BCDEF', 'November + all cycles = every November expense')
  assert.equal(filtNames({ ...nov, cycle: 'current' }), 'DEF', 'November + current cycle')
  assert.equal(filtNames({ ...nov, cycle: 'previous' }), 'BC', 'November + previous cycle')
  assert.equal(filtNames({ period: 'last-month', cycle: 'current' }), '', 'October + current cycle share no days')
  assert.equal(filtNames({ period: 'last-month', cycle: 'previous' }), 'A', 'October + previous cycle = Oct 6-31 (H on Oct 5 is outside)')
  assert.equal(filtNames({ period: 'all', cycle: 'all' }), 'ABCDEFGH', 'all time + all cycles = everything')
  assert.equal(filtNames({ period: 'all', cycle: 'current' }), 'DEFG')
  assert.equal(filtNames({}), 'ABCDEFGH', 'no filters = everything')
})

test('filter: an individual cycle picked from listCycles()', () => {
  const octCycle = listCycles(FIXED, 6, NOW(2026, 11, 15)).find((c) => c.startKey === '2026-10-06')
  assert.equal(filtNames({ cycle: octCycle }), 'ABC')
  assert.equal(filtNames({ cycle: octCycle, period: 'this-month' }), 'BC')
})

test('filter: result is the intersection of the two ranges, whatever the combination', () => {
  const now = NOW(2026, 11, 15)
  for (const period of ['this-month', 'last-month', 'this-week', 'this-year', 'previous-year', 'all']) {
    for (const cycle of ['all', 'current', 'previous']) {
      const f = resolveFilters({ period, cycle, now, resetDay: 6 })
      const got = ids(filterTransactions(FIXED, { period, cycle, now, resetDay: 6 }))
      const want = ids(FIXED.filter((t) => {
        const k = localDayKey(t.date)
        return !f.empty && (f.startKey === null || k >= f.startKey) && (f.endKey === null || k <= f.endKey)
      }))
      assert.deepEqual(got, want, `${period} + ${cycle}`)
    }
  }
})

test('filter: empty intersection reports empty and returns nothing', () => {
  const f = resolveFilters({ period: 'last-month', cycle: 'current', now: NOW(2026, 11, 15), resetDay: 6 })
  assert.equal(f.empty, true)
  assert.deepEqual(filterTransactions(FIXED, { period: 'last-month', cycle: 'current', now: NOW(2026, 11, 15), resetDay: 6 }), [])
})

test('filter: category and search combine with the date filters', () => {
  const items = [
    tx(local(2026, 11, 10), 10, { categoryId: 'food', note: 'Lunch at Café' }),
    tx(local(2026, 11, 11), 20, { categoryId: 'travel', note: 'Taxi to lunch' }),
    tx(local(2026, 11, 12), 30, { categoryId: 'food', note: undefined }),
    tx(local(2026, 10, 12), 40, { categoryId: 'food', note: 'lunch last month' }),
  ]
  const f = (o) => filterTransactions(items, { now: NOW(2026, 11, 15), resetDay: 6, ...o }).map((t) => t.amount)
  assert.deepEqual(f({ period: 'this-month', query: 'LUNCH' }), [10, 20])
  assert.deepEqual(f({ period: 'this-month', query: '  lunch  ' }), [10, 20])
  assert.deepEqual(f({ period: 'this-month', query: 'lunch', categoryId: 'food' }), [10])
  assert.deepEqual(f({ period: 'this-month', categoryId: 'food' }), [10, 30])
  assert.deepEqual(f({ categoryId: 'all' }), [10, 20, 30, 40])
  assert.deepEqual(f({ query: 'café' }), [10])
  assert.deepEqual(f({ query: 'nothing matches' }), [])
})

test('filter: custom range includes the WHOLE end day (old behaviour dropped later-that-day entries)', () => {
  const items = {
    before: tx(local(2026, 11, 9, 23, 59, 59), 1),
    startOfEnd: tx(local(2026, 11, 10, 0, 0, 0), 1),
    midday: tx(local(2026, 11, 10, 15, 0), 1),
    lastSecond: tx(local(2026, 11, 10, 23, 59, 59), 1),
    after: tx(local(2026, 11, 11, 0, 0, 0), 1),
  }
  const list = Object.values(items)
  const period = { id: 'custom', start: '2026-11-10', end: '2026-11-10' }
  assert.deepEqual(ids(filterTransactions(list, { period })), ids([items.startOfEnd, items.midday, items.lastSecond]))

  // The legacy check from ExpensesView: end = new Date('2026-11-10') (UTC midnight), d <= end.
  const legacyEnd = new Date('2026-11-10')
  const legacyKept = list.filter((t) => new Date(t.date) <= legacyEnd && new Date(t.date) >= new Date('2026-11-10'))
  assert.ok(!legacyKept.includes(items.midday), 'the legacy filter would have lost the mid-day entry')
})

test('filter: custom range with a date-picker entry on the end day', pickerOpts, () => {
  const onEnd = tx(picked('2026-11-10'), 1)
  const next = tx(picked('2026-11-11'), 1)
  const got = filterTransactions([onEnd, next], { period: { id: 'custom', start: '2026-11-01', end: '2026-11-10' } })
  assert.deepEqual(ids(got), ids([onEnd]))
})

test('filter: custom range open on either side', () => {
  assert.equal(names(filterTransactions(FIXED, { period: { id: 'custom', start: '2026-11-15' } })), 'EFG')
  assert.equal(names(filterTransactions(FIXED, { period: { id: 'custom', end: '2026-11-01' } })), 'ABH')
})

test('filter: unreadable dates are kept only when no date bound applies', () => {
  const broken = tx('not a date', 5, { note: 'X' })
  const list = [broken, E]
  assert.equal(filterTransactions(list, { period: 'all' }).length, 2)
  assert.equal(filterTransactions(list, { period: 'this-month', now: NOW(2026, 11, 15) }).length, 1)
  assert.equal(filterTransactions(list, { cycle: 'current', now: NOW(2026, 11, 15), resetDay: 6 }).length, 1)
})

test('filter: empty and null lists', () => {
  assert.deepEqual(filterTransactions([], { period: 'this-month' }), [])
  assert.deepEqual(filterTransactions(null, {}), [])
  assert.deepEqual(filterTransactions(undefined), [])
})

test('filter: does not mutate its input and returns a new array in the original order', () => {
  const frozen = deepFreeze([tx(local(2026, 11, 2), 1), tx(local(2026, 11, 1), 2)])
  const out = filterTransactions(frozen, { period: 'all' })
  assert.notEqual(out, frozen)
  assert.deepEqual(out, frozen)
})

test('filter: current/previous cycle without a reset day is an error, not a silent wrong answer', () => {
  assert.throws(() => filterTransactions(FIXED, { cycle: 'current', now: NOW(2026, 11, 15) }), RangeError)
})

// ---- refunds & summarize ----------------------------------------------------

test('refunds: only kind "refund" reduces spending; missing or unknown kind is an ordinary expense', () => {
  assert.equal(isRefund(refund(local(2026, 11, 1), 1)), true)
  assert.equal(isRefund(tx(local(2026, 11, 1), 1)), false)
  assert.equal(isRefund(tx(local(2026, 11, 1), 1, { kind: 'expense' })), false)
  assert.equal(isRefund(tx(local(2026, 11, 1), 1, { kind: 'weird' })), false)
  const s = summarize([tx(local(2026, 11, 1), 100), tx(local(2026, 11, 1), 50, { kind: 'weird' }), tx(local(2026, 11, 1), 10, { kind: undefined })], { now: NOW(2026, 11, 15) })
  assert.equal(s.gross, 160)
  assert.equal(s.net, 160)
  assert.equal(s.refundCount, 0)
})

test('summarize: empty data', () => {
  const s = summarize([], { now: NOW(2026, 11, 15) })
  assert.deepEqual(s, { count: 0, expenseCount: 0, refundCount: 0, gross: 0, refunds: 0, net: 0, days: 0, dailyAverage: 0, activeDays: 0, averagePerActiveDay: 0, largest: null })
  assert.deepEqual(summarize(null), { ...s })
  assert.deepEqual(categoryBreakdown([]), [])
  assert.deepEqual(groupByDay([]), [])
  assert.deepEqual(compareMonths([], { now: NOW(2026, 11, 15) }).byCategory, [])
})

test('summarize: gross, refunds, net and counts', () => {
  const s = summarize([tx(local(2026, 11, 1), 100.1), tx(local(2026, 11, 2), 200.2), refund(local(2026, 11, 3), 50.05)], { now: NOW(2026, 11, 15) })
  assert.equal(s.count, 3)
  assert.equal(s.expenseCount, 2)
  assert.equal(s.refundCount, 1)
  assert.equal(s.gross, 300.3)
  assert.equal(s.refunds, 50.05)
  assert.equal(s.net, 250.25)
})

test('summarize: money is exact (no floating point drift)', () => {
  assert.equal(summarize([tx(local(2026, 11, 1), 0.1), tx(local(2026, 11, 1), 0.2)]).net, 0.3)
  assert.equal(summarize(Array.from({ length: 10 }, () => tx(local(2026, 11, 1), 0.1))).net, 1)
  assert.equal(summarize([tx(local(2026, 11, 1), 19.99), tx(local(2026, 11, 1), 19.99), tx(local(2026, 11, 1), 19.99)]).net, 59.97)
})

test('summarize: a refund larger than the expenses in the period gives negative net spending', () => {
  const list = [tx(local(2026, 11, 2), 100), refund(local(2026, 11, 3), 250)]
  const s = summarize(list, { now: NOW(2026, 11, 15) })
  assert.equal(s.gross, 100)
  assert.equal(s.refunds, 250)
  assert.equal(s.net, -150)
  assert.ok(s.dailyAverage < 0)
  const [only] = categoryBreakdown(list)
  assert.equal(only.net, -150)
  assert.equal(only.share, 0)
  const cmp = compareMonths(list, { now: NOW(2026, 11, 15) })
  assert.equal(cmp.monthToDate.current, -150)
})

test('summarize: unreadable amounts count as 0 rather than poisoning the total', () => {
  const s = summarize([tx(local(2026, 11, 1), 'abc'), tx(local(2026, 11, 1), 10), tx(local(2026, 11, 1), undefined)])
  assert.equal(s.net, 10)
  assert.equal(s.count, 3)
})

test('summarize: days and daily average follow the selected range, never counting future days', () => {
  const now = NOW(2026, 11, 15)
  const list = [tx(local(2026, 11, 2), 1000), tx(local(2026, 11, 14), 500)] // net 1500
  const sum = (filters) => summarize(filterTransactions(list, { now, resetDay: 6, ...filters }), { range: resolveFilters({ now, resetDay: 6, ...filters }), now })

  const thisMonth = sum({ period: 'this-month' })
  assert.equal(thisMonth.days, 15) // Nov 1..15, not 30
  assert.equal(thisMonth.dailyAverage, 100)

  const cycle = sum({ cycle: 'current' }) // Nov 6..15
  assert.equal(cycle.days, 10)
  assert.equal(cycle.net, 500)
  assert.equal(cycle.dailyAverage, 50)

  const lastMonth = summarize([tx(local(2026, 10, 10), 3100)], { range: resolveFilters({ period: 'last-month', now }), now })
  assert.equal(lastMonth.days, 31)
  assert.equal(lastMonth.dailyAverage, 100)

  const future = summarize([], { range: resolveFilters({ period: { id: 'custom', start: '2026-12-01', end: '2026-12-31' }, now }), now })
  assert.equal(future.days, 0)
  assert.equal(future.dailyAverage, 0)

  const none = summarize([], { range: resolveFilters({ period: 'last-month', cycle: 'current', now, resetDay: 6 }), now })
  assert.equal(none.days, 0, 'empty intersection has no days')

  const allTime = summarize(list, { now }) // first transaction (Nov 2) .. today (Nov 15)
  assert.equal(allTime.days, 14)
})

// ---- totals come from raw records (no double counting) ----------------------

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDataset(count = 400, seed = 7) {
  const rand = mulberry32(seed)
  const cats = ['food', 'bills', 'travel', 'shopping', null]
  const out = []
  for (let i = 0; i < count; i++) {
    const dayOffset = Math.floor(rand() * 760) // ~2 years
    const base = new Date(2025, 0, 1 + dayOffset, Math.floor(rand() * 24), Math.floor(rand() * 60))
    const amount = Math.round(rand() * 500000) / 100 // 0.00 - 5000.00, two decimals
    const extra = { categoryId: cats[Math.floor(rand() * cats.length)] }
    out.push(rand() < 0.12 ? refund(base.toISOString(), amount / 5, extra) : tx(base.toISOString(), amount, extra))
  }
  return out
}

test('totals: the sum over cycles and over months equals the all-time total (nothing double counted)', () => {
  const data = randomDataset()
  const now = NOW(2027, 1, 20)
  const allNet = summarize(data, { now }).net

  const byCycle = listCycles(data, 6, now).reduce((sum, c) => sum + summarize(filterTransactions(data, { cycle: c })).net, 0)
  assert.equal(Math.round(byCycle * 100), Math.round(allNet * 100), 'cycles partition the data')

  const months = new Set(data.map((t) => localDayKey(t.date).slice(0, 7)))
  let byMonth = 0
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number)
    const period = { id: 'custom', start: `${m}-01`, end: `${m}-${String(daysInMonth(y, mo)).padStart(2, '0')}` }
    byMonth += summarize(filterTransactions(data, { period })).net
  }
  assert.equal(Math.round(byMonth * 100), Math.round(allNet * 100), 'months partition the data')
})

test('totals: category breakdown adds up to the summary total, for every filter', () => {
  const data = randomDataset(500, 11)
  const now = NOW(2026, 11, 15)
  const combos = [
    {},
    { period: 'this-month' },
    { period: 'last-month' },
    { period: 'this-year' },
    { period: 'previous-year' },
    { cycle: 'current' },
    { cycle: 'previous' },
    { period: 'this-year', cycle: 'previous' },
    { period: { id: 'custom', start: '2026-03-01', end: '2026-06-30' } },
    { categoryId: 'food' },
    { query: 'zzz' },
  ]
  for (const combo of combos) {
    const list = filterTransactions(data, { now, resetDay: 6, ...combo })
    const sum = summarize(list, { now })
    const cats = categoryBreakdown(list)
    const catNet = cats.reduce((s, c) => s + Math.round(c.net * 100), 0)
    const catGross = cats.reduce((s, c) => s + Math.round(c.gross * 100), 0)
    const catRefunds = cats.reduce((s, c) => s + Math.round(c.refunds * 100), 0)
    assert.equal(catNet, Math.round(sum.net * 100), `net ${JSON.stringify(combo)}`)
    assert.equal(catGross, Math.round(sum.gross * 100), `gross ${JSON.stringify(combo)}`)
    assert.equal(catRefunds, Math.round(sum.refunds * 100), `refunds ${JSON.stringify(combo)}`)
    assert.equal(cats.reduce((s, c) => s + c.count, 0), sum.count)
  }
})

test('categoryBreakdown: sorted by net, null category grouped, shares sum to 100 when all positive', () => {
  const list = [
    tx(local(2026, 11, 1), 300, { categoryId: 'food' }),
    tx(local(2026, 11, 1), 100, { categoryId: 'food' }),
    tx(local(2026, 11, 1), 500, { categoryId: 'travel' }),
    tx(local(2026, 11, 1), 100, { categoryId: null }),
    tx(local(2026, 11, 1), 0, { categoryId: undefined }),
  ]
  const cats = categoryBreakdown(list)
  assert.deepEqual(cats.map((c) => [c.categoryId, c.net]), [['travel', 500], ['food', 400], [null, 100]])
  assert.equal(cats.find((c) => c.categoryId === null).count, 2)
  assert.ok(Math.abs(cats.reduce((s, c) => s + c.share, 0) - 100) < 1e-9)
})

test('categoryBreakdown: refunds reduce their own category; refund-only category goes negative', () => {
  const cats = categoryBreakdown([tx(local(2026, 11, 1), 100, { categoryId: 'food' }), refund(local(2026, 11, 2), 30, { categoryId: 'food' }), refund(local(2026, 11, 2), 20, { categoryId: 'shopping' })])
  const food = cats.find((c) => c.categoryId === 'food')
  const shop = cats.find((c) => c.categoryId === 'shopping')
  assert.equal(food.net, 70)
  assert.equal(food.gross, 100)
  assert.equal(food.refunds, 30)
  assert.equal(shop.net, -20)
  assert.equal(shop.share, 0)
  assert.equal(food.share, 100, 'shares are relative to categories with positive net, so they never exceed 100')
})

// ---- groupByDay -------------------------------------------------------------

test('groupByDay: groups by LOCAL day with net subtotals, newest day first', () => {
  const late = tx(local(2026, 11, 1, 0, 30), 10, { createdAt: '2026-11-01T00:30:00.000Z' })
  const prevNight = tx(local(2026, 10, 31, 23, 30), 20)
  const same1 = tx(local(2026, 11, 1, 9, 0), 30, { createdAt: '2026-11-01T09:00:00.000Z' })
  const ref = refund(local(2026, 11, 1, 18, 0), 5, { createdAt: '2026-11-01T18:00:00.000Z' })
  const groups = groupByDay([prevNight, late, same1, ref])
  assert.deepEqual(groups.map((g) => g.dayKey), ['2026-11-01', '2026-10-31'])
  assert.equal(groups[0].count, 3)
  assert.equal(groups[0].net, 35) // 10 + 30 - 5
  assert.equal(groups[1].net, 20)
  assert.deepEqual(groups[0].items.map((t) => t.id), [ref.id, same1.id, late.id], 'most recently created first within a day')
})

test('groupByDay: date-picker entries and "now" entries on the same day land in one group', pickerOpts, () => {
  const a = tx(picked('2026-11-03'), 10)
  const b = tx(local(2026, 11, 3, 14, 0), 5)
  const groups = groupByDay([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].dayKey, '2026-11-03')
  assert.equal(groups[0].net, 15)
})

test('groupByDay: unreadable dates go in a last group so no money disappears', () => {
  const groups = groupByDay([tx('nope', 7), tx(local(2026, 11, 3), 3)])
  assert.deepEqual(groups.map((g) => g.dayKey), ['2026-11-03', null])
  assert.equal(groups[1].net, 7)
})

// ---- compareMonths ----------------------------------------------------------

test('compareMonths: month-to-date vs the same span of last month, plus full month', () => {
  const list = [
    tx(local(2026, 10, 10), 100), // Oct 1-15 span
    tx(local(2026, 10, 20), 300), // outside the like-for-like span
    tx(local(2026, 11, 5), 150),
    tx(local(2026, 11, 20), 50), // future-dated: in the full month, not month-to-date
  ]
  const r = compareMonths(list, { now: NOW(2026, 11, 15) })
  assert.equal(r.currentMonth, '2026-11')
  assert.equal(r.previousMonth, '2026-10')
  assert.equal(r.daysElapsed, 15)
  assert.equal(r.previousSpanDays, 15)
  assert.equal(r.previousSpanClamped, false)
  assert.deepEqual(r.monthToDate, { current: 150, previous: 100, change: 50, changePct: 50 })
  assert.deepEqual(r.fullMonth, { current: 200, previous: 400, change: -200, changePct: -50, currentIsComplete: false })
})

test('compareMonths: entries just after / before local midnight stay in their own month', () => {
  const list = [
    tx(local(2026, 10, 31, 23, 30), 100), // October
    tx(local(2026, 11, 1, 0, 30), 10), // November, even where the UTC date is still Oct 31
  ]
  const r = compareMonths(list, { now: NOW(2026, 11, 15) })
  assert.equal(r.fullMonth.current, 10, 'Nov 1 00:30 belongs to November')
  assert.equal(r.fullMonth.previous, 100, 'Oct 31 23:30 belongs to October')
  assert.equal(r.monthToDate.current, 10)
  assert.equal(r.monthToDate.previous, 0, 'Oct 31 is outside the like-for-like span (Oct 1-15)')
})

test('compareMonths: January compares against December of the previous year', () => {
  const list = [tx(local(2026, 12, 5), 100), tx(local(2026, 12, 25), 900), tx(local(2027, 1, 4), 120)]
  const r = compareMonths(list, { now: NOW(2027, 1, 10) })
  assert.equal(r.previousMonth, '2026-12')
  assert.deepEqual(r.monthToDate, { current: 120, previous: 100, change: 20, changePct: 20 })
  assert.equal(r.fullMonth.previous, 1000)
})

test('compareMonths: when last month is shorter than today\'s day number the whole of it is used', () => {
  const list = [tx(local(2026, 2, 1), 100), tx(local(2026, 2, 28), 100), tx(local(2026, 3, 31), 50)]
  const r = compareMonths(list, { now: NOW(2026, 3, 31) })
  assert.equal(r.previousSpanDays, 28)
  assert.equal(r.previousSpanClamped, true)
  assert.equal(r.monthToDate.previous, 200)
  assert.equal(r.fullMonth.currentIsComplete, true) // Mar 31 is the last day

  const notClamped = compareMonths(list, { now: NOW(2026, 3, 28) })
  assert.equal(notClamped.previousSpanClamped, false)

  const leap = compareMonths([tx(local(2028, 2, 29), 10)], { now: NOW(2028, 3, 30) })
  assert.equal(leap.previousSpanDays, 29)
  assert.equal(leap.previousSpanClamped, true)
  assert.equal(leap.monthToDate.previous, 10)
})

test('compareMonths: percent change is null (not 100%) when there is nothing to compare against', () => {
  const none = compareMonths([tx(local(2026, 11, 5), 100)], { now: NOW(2026, 11, 15) })
  assert.equal(none.monthToDate.previous, 0)
  assert.equal(none.monthToDate.changePct, null)
  const refundsOnly = compareMonths([refund(local(2026, 10, 5), 40), tx(local(2026, 11, 5), 100)], { now: NOW(2026, 11, 15) })
  assert.equal(refundsOnly.monthToDate.previous, -40)
  assert.equal(refundsOnly.monthToDate.changePct, null)
})

test('compareMonths: refunds reduce net in both months; categories add up to the total', () => {
  const list = [
    tx(local(2026, 10, 3), 200, { categoryId: 'food' }),
    refund(local(2026, 10, 4), 50, { categoryId: 'food' }),
    tx(local(2026, 10, 5), 70, { categoryId: 'travel' }),
    tx(local(2026, 10, 25), 90, { categoryId: 'gym' }), // only in last month, outside the span
    tx(local(2026, 11, 2), 100, { categoryId: 'food' }),
    tx(local(2026, 11, 9), 40, { categoryId: 'shopping' }),
    refund(local(2026, 11, 10), 10, { categoryId: 'shopping' }),
  ]
  const r = compareMonths(list, { now: NOW(2026, 11, 15) })
  assert.equal(r.monthToDate.previous, 220) // 200 - 50 + 70
  assert.equal(r.monthToDate.current, 130) // 100 + 40 - 10
  const sumCur = r.byCategory.reduce((s, c) => s + Math.round(c.monthToDate.current * 100), 0)
  const sumPrev = r.byCategory.reduce((s, c) => s + Math.round(c.monthToDate.previous * 100), 0)
  const sumFullPrev = r.byCategory.reduce((s, c) => s + Math.round(c.fullMonth.previous * 100), 0)
  assert.equal(sumCur, 13000)
  assert.equal(sumPrev, 22000)
  assert.equal(sumFullPrev, Math.round(r.fullMonth.previous * 100))
  const gym = r.byCategory.find((c) => c.categoryId === 'gym')
  assert.deepEqual([gym.monthToDate.current, gym.monthToDate.previous, gym.fullMonth.previous], [0, 0, 90], 'a category only present last month still appears')
  assert.equal(r.byCategory[0].categoryId, 'food', 'sorted by current month-to-date')
})

test('compareMonths: unreadable dates are ignored', () => {
  const r = compareMonths([tx('nope', 999), tx(local(2026, 11, 5), 10)], { now: NOW(2026, 11, 15) })
  assert.equal(r.monthToDate.current, 10)
})

// ---- purity / guards --------------------------------------------------------

test('every function accepts frozen input (nothing is mutated)', () => {
  const data = deepFreeze(randomDataset(60, 3))
  const now = NOW(2026, 11, 15)
  filterTransactions(data, { period: 'this-month', cycle: 'current', now, resetDay: 6, query: 'a' })
  summarize(data, { now })
  categoryBreakdown(data)
  groupByDay(data)
  compareMonths(data, { now })
  listCycles(data, 6, now)
})

test('reporting.js stays pure: no imports, no slicing of stored dates, no setMonth', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/utils/reporting.js', import.meta.url)), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  assert.doesNotMatch(code, /^\s*import\s/m, 'no imports (so no Vue / storage)')
  assert.doesNotMatch(code, /\.date\b[^\n;]*\.slice\(/, 'never slice a stored date string')
  assert.doesNotMatch(code, /toISOString\(\)\s*\.slice/, 'never derive a day from an ISO string')
  assert.doesNotMatch(code, /setMonth\(/, 'setMonth overflows for reset days 29-31')
  assert.doesNotMatch(code, /localStorage|document|window/, 'no browser globals')
})

// ===========================================================================
// Phase 1.2 additions
// ===========================================================================

// ---- stored dates: local noon (write side) ---------------------------------

test('localNoonISO: stores local noon and reads back as the same day for EVERY day of 2026 and 2028 in this zone', () => {
  let day = '2026-01-01'
  while (day <= '2026-12-31') {
    const iso = localNoonISO(day)
    assert.equal(localDayKey(iso), day, `round trip ${day}`)
    assert.equal(new Date(iso).getHours(), 12, `${day} is stored at local noon`)
    day = addDays(day, 1)
  }
  for (const d of ['2028-02-28', '2028-02-29', '2028-03-01', '2026-03-08', '2026-03-29', '2026-11-01', '2026-12-31', '2027-01-01']) {
    assert.equal(localDayKey(localNoonISO(d)), d, d)
  }
})

test('localNoonISO: rejects anything that is not a real day', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '11/02/2026', '', null, undefined]) assert.throws(() => localNoonISO(bad), RangeError, String(bad))
})

test('stored dates: OLD (UTC-midnight) and NEW (local-noon) records both resolve to the picked day and group together', pickerOpts, () => {
  const old = tx(picked('2026-11-02'), 10) // saved by the previous version of the form
  const fresh = tx(localNoonISO('2026-11-02'), 5) // saved by the new form
  assert.equal(localDayKey(old.date), '2026-11-02')
  assert.equal(localDayKey(fresh.date), '2026-11-02')
  const groups = groupByDay([old, fresh])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].dayKey, '2026-11-02')
  assert.equal(groups[0].net, 15)
  // and they filter identically, including the exact edges of a custom range
  const edge = { period: { id: 'custom', start: '2026-11-02', end: '2026-11-02' } }
  assert.deepEqual(ids(filterTransactions([old, fresh], edge)), ids([old, fresh]))
})

test('stored dates: NEW local-noon records land on the right day in EVERY zone (what the old format could not do)', () => {
  const fresh = tx(localNoonISO('2026-11-02'), 5)
  assert.equal(localDayKey(fresh.date), '2026-11-02')
  assert.deepEqual(ids(filterTransactions([fresh], { period: { id: 'custom', start: '2026-11-02', end: '2026-11-02' } })), ids([fresh]))
  assert.equal(compareMonths([fresh], { now: NOW(2026, 11, 15) }).monthToDate.current, 5)
  assert.equal(cycleContaining(fresh.date, 6).startKey, '2026-10-06')
})

test('resolveSavedDate: an unchanged day keeps the stored value byte-for-byte; a changed day becomes local noon', () => {
  const nowStyle = local(2026, 11, 2, 0, 5)
  assert.equal(resolveSavedDate(nowStyle, '2026-11-02'), nowStyle, 'editing a note must not rewrite the date')
  assert.equal(resolveSavedDate(nowStyle, '2026-11-03'), localNoonISO('2026-11-03'))
  assert.equal(resolveSavedDate(undefined, '2026-11-03'), localNoonISO('2026-11-03'), 'new record')
  assert.equal(resolveSavedDate(null, '2026-11-03'), localNoonISO('2026-11-03'))
  assert.equal(resolveSavedDate('garbage', '2026-11-03'), localNoonISO('2026-11-03'))
})

test('resolveSavedDate: an OLD UTC-midnight record opened and saved without changing the day keeps its stored date', pickerOpts, () => {
  const old = picked('2026-11-02')
  assert.equal(resolveSavedDate(old, localDayKey(old)), old)
  assert.equal(resolveSavedDate(old, '2026-11-05'), localNoonISO('2026-11-05'))
})

// ---- sorting ---------------------------------------------------------------

test('sortTransactions: newest / oldest order by LOCAL day, then by when they were entered', () => {
  const a = tx(local(2026, 11, 1, 0, 30), 1, { createdAt: '2026-11-01T01:00:00.000Z' })
  const b = tx(local(2026, 10, 31, 23, 30), 1, { createdAt: '2026-10-31T23:00:00.000Z' })
  const c = tx(local(2026, 11, 1, 18, 0), 1, { createdAt: '2026-11-01T18:00:00.000Z' }) // same local day as a, entered later
  const d = tx(local(2026, 11, 20, 9, 0), 1, { createdAt: '2026-11-20T09:00:00.000Z' })
  const list = [a, b, c, d]
  assert.deepEqual(sortTransactions(list, 'newest').map((t) => t.id), [d.id, c.id, a.id, b.id])
  assert.deepEqual(sortTransactions(list, 'oldest').map((t) => t.id), [b.id, a.id, c.id, d.id])
  assert.deepEqual(sortTransactions(list).map((t) => t.id), [d.id, c.id, a.id, b.id], 'default is newest')
})

test('sortTransactions: highest / lowest by amount (refunds by their positive amount), ties newest first', () => {
  const small = tx(local(2026, 11, 1), 10)
  const big = tx(local(2026, 11, 2), 500)
  const bigRefund = refund(local(2026, 11, 3), 500)
  const tieOlder = tx(local(2026, 11, 4), 10)
  const list = [small, big, bigRefund, tieOlder]
  assert.deepEqual(sortTransactions(list, 'highest').map((t) => t.id), [bigRefund.id, big.id, tieOlder.id, small.id])
  assert.deepEqual(sortTransactions(list, 'lowest').map((t) => t.id), [tieOlder.id, small.id, bigRefund.id, big.id])
})

test('sortTransactions: unreadable dates sort last for date sorts; never mutates; unknown mode throws', () => {
  const broken = tx('nope', 1)
  const ok = tx(local(2026, 11, 1), 1)
  assert.deepEqual(sortTransactions([broken, ok], 'newest').map((t) => t.id), [ok.id, broken.id])
  assert.deepEqual(sortTransactions([broken, ok], 'oldest').map((t) => t.id), [ok.id, broken.id])
  const frozen = deepFreeze([ok, broken])
  assert.notEqual(sortTransactions(frozen, 'newest'), frozen)
  assert.deepEqual(sortTransactions([], 'newest'), [])
  assert.deepEqual(sortTransactions(null, 'newest'), [])
  assert.throws(() => sortTransactions([ok], 'biggest'), RangeError)
  assert.deepEqual(SORT_MODES, ['newest', 'oldest', 'highest', 'lowest'])
})

test('groupByDay: oldest-first order flips days and the order inside a day', () => {
  const a = tx(local(2026, 11, 3, 9), 1, { createdAt: '2026-11-03T09:00:00.000Z' })
  const b = tx(local(2026, 11, 3, 18), 2, { createdAt: '2026-11-03T18:00:00.000Z' })
  const c = tx(local(2026, 11, 1, 12), 4)
  const groups = groupByDay([a, b, c], { order: 'oldest' })
  assert.deepEqual(groups.map((g) => g.dayKey), ['2026-11-01', '2026-11-03'])
  assert.deepEqual(groups[1].items.map((t) => t.id), [a.id, b.id])
  assert.deepEqual(groupByDay([a, b, c]).map((g) => g.dayKey), ['2026-11-03', '2026-11-01'])
  assert.throws(() => groupByDay([a], { order: 'sideways' }), RangeError)
  // an unreadable date stays last whichever way the days run
  assert.equal(groupByDay([tx('nope', 1), a], { order: 'oldest' }).at(-1).dayKey, null)
})

// ---- search by note AND category name --------------------------------------

test('search matches the note or the category name', () => {
  const names = { 'cat-food': 'Food', 'cat-gym': 'Gym' }
  const items = [
    tx(local(2026, 11, 10), 1, { categoryId: 'cat-food', note: 'lunch' }),
    tx(local(2026, 11, 10), 2, { categoryId: 'cat-gym', note: 'monthly fee' }),
    tx(local(2026, 11, 10), 3, { categoryId: 'cat-gym', note: 'protein FOOD bar' }),
    tx(local(2026, 11, 10), 4, { categoryId: 'cat-deleted', note: '' }),
  ]
  const f = (query, categoryNames = names) => filterTransactions(items, { query, categoryNames }).map((t) => t.amount)
  assert.deepEqual(f('food'), [1, 3], 'category name Food (1) and the note containing food (3)')
  assert.deepEqual(f('GYM'), [2, 3])
  assert.deepEqual(f('fee'), [2])
  assert.deepEqual(f('food', null), [3], 'without names only notes match')
  assert.deepEqual(f('food', new Map(Object.entries(names))), [1, 3], 'a Map works too')
  assert.deepEqual(f('deleted'), [], 'an id with no name is not searchable by its id')
  assert.deepEqual(f('food gym'), [], 'the whole phrase must match')
})

// ---- summary extras --------------------------------------------------------

test('summarize: active days, average per active day, and the largest single expense', () => {
  const big = tx(local(2026, 11, 3), 900, { note: 'rent top-up', categoryId: 'bills' })
  const list = [
    tx(local(2026, 11, 2, 9), 100),
    tx(local(2026, 11, 2, 21), 50), // same day
    big,
    refund(local(2026, 11, 9), 2000), // a bigger refund must never be "largest"
    tx(local(2026, 11, 9), 50),
    tx('nope', 7), // unreadable date: counted in money, not in active days
  ]
  const s = summarize(list, { now: NOW(2026, 11, 15) })
  assert.equal(s.activeDays, 3)
  assert.equal(s.net, 100 + 50 + 900 - 2000 + 50 + 7)
  assert.equal(s.averagePerActiveDay, Math.round((s.net / 3) * 100) / 100)
  assert.deepEqual(s.largest, { id: big.id, amount: 900, date: big.date, categoryId: 'bills', note: 'rent top-up' })
  assert.equal(summarize([refund(local(2026, 11, 9), 5)]).largest, null, 'refunds only: no largest expense')
  const tie = [tx(local(2026, 11, 1), 10), tx(local(2026, 11, 2), 10)]
  assert.equal(summarize(tie).largest.id, tie[0].id, 'first one wins a tie')
})

// ---- plain-words descriptions ----------------------------------------------

test('formatDayKey / cycleLabel', () => {
  assert.equal(formatDayKey('2026-11-06'), '6 Nov 2026')
  assert.equal(formatDayKey('2028-02-29'), '29 Feb 2028')
  assert.equal(formatDayKey('2026-11-06', { weekday: true }), 'Fri 6 Nov 2026')
  assert.equal(formatDayKey('2026-11-15', { weekday: true }), 'Sun 15 Nov 2026')
  assert.equal(formatDayKey('2028-02-29', { weekday: true }), 'Tue 29 Feb 2028')
  assert.equal(cycleLabel({ startKey: '2026-11-06', endKey: '2026-12-05' }), '6 Nov – 5 Dec 2026')
  assert.equal(cycleLabel({ startKey: '2026-12-06', endKey: '2027-01-05' }), '6 Dec 2026 – 5 Jan 2027')
  assert.throws(() => formatDayKey('nope'), RangeError)
})

test('describeRange: every shape of range in words', () => {
  assert.equal(describeRange({ startKey: null, endKey: null, empty: false }), 'from any date')
  assert.equal(describeRange({ startKey: '2026-11-01', endKey: '2026-11-30', empty: false }), 'from 1 Nov 2026 to 30 Nov 2026')
  assert.equal(describeRange({ startKey: '2026-11-01', endKey: '2026-11-01', empty: false }), 'on 1 Nov 2026')
  assert.equal(describeRange({ startKey: '2026-11-01', endKey: null, empty: false }), 'from 1 Nov 2026 onwards')
  assert.equal(describeRange({ startKey: null, endKey: '2026-11-01', empty: false }), 'up to 1 Nov 2026')
  assert.match(describeRange({ startKey: null, endKey: null, empty: true }), /do not overlap/)
})

test('describeFilters: only the filters that narrow the list are listed', () => {
  const now = NOW(2026, 11, 15)
  const resolve = (sel) => resolveFilters({ ...sel, now, resetDay: 6 })
  let sel = { period: 'all', cycle: 'current' }
  let d = describeFilters(resolve(sel), sel)
  assert.deepEqual(d.parts, ['Current cycle (6 Nov – 5 Dec 2026)'])
  assert.equal(d.sentence, 'Showing transactions from 6 Nov 2026 to 5 Dec 2026')

  sel = { period: 'this-month', cycle: 'previous', categoryId: 'cat-food', categoryLabel: 'Food', query: ' lunch ' }
  d = describeFilters(resolve(sel), sel)
  assert.deepEqual(d.parts, ['This month', 'Previous cycle (6 Oct – 5 Nov 2026)', 'Category: Food', 'Search: "lunch"'])
  assert.equal(d.range, 'from 1 Nov 2026 to 5 Nov 2026', 'the INTERSECTION of the month and the cycle')

  sel = { period: 'all', cycle: null }
  d = describeFilters(resolve(sel), sel)
  assert.deepEqual(d.parts, [])
  assert.equal(d.sentence, 'Showing transactions from any date')

  sel = { period: { id: 'custom', start: '2026-11-03', end: '2026-11-09' }, cycle: { startKey: '2026-10-06', endKey: '2026-11-05' } }
  d = describeFilters(resolve(sel), sel)
  assert.deepEqual(d.parts, ['Custom range', 'Cycle 6 Oct – 5 Nov 2026'])
  assert.equal(d.range, 'from 3 Nov 2026 to 5 Nov 2026')

  sel = { period: 'last-month', cycle: 'current' }
  d = describeFilters(resolve(sel), sel)
  assert.match(d.range, /do not overlap/)

  for (const id of ['this-month', 'last-month', 'this-week', 'last-week', 'this-year', 'previous-year', 'all', 'custom']) assert.ok(PERIOD_LABELS[id], id)
})

// ---- CSV -------------------------------------------------------------------

test('CSV: header, category NAME (not id), kind column, local day, always-positive amounts, CRLF', () => {
  const names = { 'cat-food': 'Food' }
  const list = [
    tx(local(2026, 11, 2, 0, 5), 1200.5, { categoryId: 'cat-food', note: 'lunch', source: 'manual' }),
    refund(local(2026, 11, 3, 14), 300, { categoryId: 'cat-food', note: 'returned', source: 'manual' }),
  ]
  const csv = transactionsToCsv(list, { categoryNames: names })
  assert.equal(csv, 'date,amount,kind,category,note,source\r\n2026-11-02,1200.50,expense,Food,lunch,manual\r\n2026-11-03,300.00,refund,Food,returned,manual\r\n')
  assert.ok(!csv.includes('cat-food'), 'ids never leak into the export')
})

test('CSV: quoting, embedded quotes/commas/newlines, unicode, and spreadsheet formula injection', () => {
  const names = { c1: 'Food, "drink" & more' }
  const list = [
    tx(local(2026, 11, 2), 5, { categoryId: 'c1', note: 'a, "quoted"\nsecond line' }),
    tx(local(2026, 11, 2), 5, { categoryId: 'c1', note: '=HYPERLINK("http://x","click")' }),
    tx(local(2026, 11, 2), 5, { categoryId: 'c1', note: '+1 or -2 or @home' }),
    tx(local(2026, 11, 2), 5, { categoryId: 'c1', note: 'Café ₨ 100' }),
    tx(local(2026, 11, 2), 5, { categoryId: 'c1', note: '-5' }),
  ]
  const csv = transactionsToCsv(list, { categoryNames: names })
  assert.equal(csv.split('\r\n').at(-1), '', 'ends with a line break')
  assert.ok(csv.includes('"Food, ""drink"" & more"'), 'category with comma and quotes is escaped')
  assert.ok(csv.includes('"a, ""quoted""\nsecond line"'), 'newline stays inside the quoted cell')
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""click"")"`), 'a formula note is neutralised with a leading apostrophe')
  assert.ok(csv.includes("'+1 or -2 or @home"), 'a leading + is neutralised')
  assert.ok(csv.includes(",'-5,"), 'a leading - is neutralised')
  assert.ok(csv.includes('Café ₨ 100'), 'unicode is kept')
})

test('CSV: deleted/unknown category, no category, empty list, missing fields', () => {
  const list = [tx(local(2026, 11, 2), 5, { categoryId: 'gone' }), tx(local(2026, 11, 2), 6, { categoryId: null }), { amount: 'abc', date: 'nope' }]
  const lines = transactionsToCsv(list, { categoryNames: { other: 'Other' } }).trimEnd().split('\r\n')
  assert.equal(lines[1], '2026-11-02,5.00,expense,(deleted category),,')
  assert.equal(lines[2], '2026-11-02,6.00,expense,,,')
  assert.equal(lines[3], ',0.00,expense,,,')
  assert.equal(transactionsToCsv([]), 'date,amount,kind,category,note,source\r\n')
  assert.equal(transactionsToCsv(null), 'date,amount,kind,category,note,source\r\n')
})

test('CSV of a filtered list exports exactly that list, and its amounts add up to the on-screen net', () => {
  const data = randomDataset(300, 21)
  const now = NOW(2026, 11, 15)
  const list = filterTransactions(data, { period: 'this-year', cycle: 'previous', now, resetDay: 6 })
  const csv = transactionsToCsv(list)
  const rows = csv.trimEnd().split('\r\n').slice(1)
  assert.equal(rows.length, list.length)
  const net = rows.reduce((s, r) => {
    const [, amount, kind] = r.split(',')
    return s + (kind === 'refund' ? -1 : 1) * Math.round(Number(amount) * 100)
  }, 0)
  assert.equal(net, Math.round(summarize(list, { now }).net * 100))
})
