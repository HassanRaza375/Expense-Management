// ---------------------------------------------------------------------------
// Accounts screens (Phase 2.3): the pure "view model" behind the Accounts list, the account detail ledger, the transfer
// form and the reconcile dialog. No Vue, no storage. All money maths is delegated to utils/accounts.js (2.1); this file
// only decides what to SHOW (groups, labels, signs, warnings, hints) so the .vue files stay thin and every rule here can
// be tested in Node.
// ---------------------------------------------------------------------------
import { ACCOUNT_TYPE_LABELS, accountsOverview, accountBalance, accountLedger, balanceDisplay, unassignedSince, reconcileDifference } from './accounts.js'
import { localDayKey, isDayKey, formatDayKey } from './reporting.js'

// Re-exported so the .vue files import everything account-related from here (and never from accounts.js directly).
export { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, validateAccount, validateTransfer } from './accounts.js'

const cents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fromCents = (c) => c / 100
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

const byOrderThenName = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name))

// ---- the accounts list -----------------------------------------------------------------------------------------------

/**
 * Everything the Accounts list needs. A hand-edited or restored account with a broken opening date must not crash the
 * page: it is listed with `problem` set and left out of the totals.
 * Returns { hasAccounts, active: [card], archived: [card], total, byType, activeCount }.
 * card = { id, name, type, typeLabel, archived, notes, openingDate, balance, display, olderThanOpening, scheduled, problem }.
 */
export function accountCards(store, data = {}, opts = {}) {
  const accounts = (store && store.accounts) || []
  const valid = accounts.filter((a) => isDayKey(a?.openingDate))
  const overview = accountsOverview({ ...store, accounts: valid }, data, opts)
  const card = (a) => {
    const b = overview.balances[a.id]
    const base = {
      id: a.id,
      name: a.name,
      type: a.type,
      typeLabel: ACCOUNT_TYPE_LABELS[a.type] || ACCOUNT_TYPE_LABELS.other,
      archived: !!a.archived,
      notes: a.notes || '',
      openingDate: a.openingDate,
      order: a.order ?? 0,
    }
    if (!b) return { ...base, balance: 0, display: null, olderThanOpening: 0, scheduled: 0, problem: 'This account has no valid opening date. Edit it to fix this.' }
    return { ...base, balance: b.balance, display: balanceDisplay(a, b.balance), olderThanOpening: b.olderThanOpening, scheduled: b.scheduled, problem: '' }
  }
  const cards = accounts.map(card).sort(byOrderThenName)
  const active = cards.filter((c) => !c.archived)
  return { hasAccounts: accounts.length > 0, active, archived: cards.filter((c) => c.archived), total: overview.total, byType: overview.byType, activeCount: active.length }
}

/**
 * "N transactions since <day> have no account". `since` defaults to the EARLIEST opening day of an active account (the
 * oldest day on which some account starts counting); pass an account's opening day for a per-account figure.
 * Returns { count, since, text } (text is '' when there is nothing to say).
 */
export function unassignedSummary(store, data = {}, sinceKey = null) {
  const accounts = ((store && store.accounts) || []).filter((a) => !a.archived && isDayKey(a.openingDate))
  const since = sinceKey || accounts.map((a) => a.openingDate).sort()[0] || null
  if (!since || !accounts.length) return { count: 0, since: null, text: '' }
  const u = unassignedSince(store, data, since)
  const text = u.count ? `${plural(u.count, 'transaction')} since ${formatDayKey(since)} ${u.count === 1 ? 'has' : 'have'} no account` : ''
  return { count: u.count, since, text }
}

/**
 * The balance as words, from `display` (accounts.js balanceDisplay). The sign/wording always carries the meaning, never
 * only a colour: "Owed ₨ 250", "In credit ₨ 20", "Paid off", or "−₨ 50" for a negative cash/bank balance.
 * `money(n)` formats a non-negative number.
 */
export function balanceText(display, money = (n) => String(n)) {
  if (!display) return '—'
  if (display.label === 'Owed') return `Owed ${money(display.amount)}`
  if (display.label === 'In credit') return `In credit ${money(display.amount)}`
  if (display.label === 'Paid off') return 'Paid off'
  return display.signed < 0 ? `−${money(display.amount)}` : money(display.amount)
}

// ---- the account detail ledger ---------------------------------------------------------------------------------------

const ROW_LABELS = {
  opening: 'Opening balance',
  expense: 'Expense',
  refund: 'Refund',
  income: 'Income',
  'transfer-out': 'Transfer out',
  'transfer-in': 'Transfer in',
  correction: 'Correction',
  'loan-out': 'Loan given',
  'loan-in': 'Loan received',
  'repayment-in': 'Repayment received',
  'repayment-out': 'Repayment made',
  'investment-out': 'Investment contribution',
  'investment-in': 'Investment withdrawal',
}

/**
 * Describe one ledger row for display. lookups = { categoryName(id), incomeLabel(sourceType), accountName(id) }.
 * Returns the row plus { label, title, subtitle, sign: '+' | '−' | '', editable, deletable, reconciledTo }.
 * `label` is a TEXT label shown on every row (colour is never the only signal).
 */
export function describeRow(row, lookups = {}) {
  const categoryName = (id) => (lookups.categoryName ? lookups.categoryName(id) : '') || ''
  const incomeLabel = (t) => (lookups.incomeLabel ? lookups.incomeLabel(t) : '') || ''
  const accountName = (id) => (lookups.accountName ? lookups.accountName(id) : '') || 'a deleted account'
  const rec = row.record || {}
  let title
  let subtitle = ''
  switch (row.type) {
    case 'expense':
    case 'refund':
      title = rec.note || categoryName(rec.categoryId) || ROW_LABELS[row.type]
      subtitle = rec.note ? categoryName(rec.categoryId) : ''
      break
    case 'income':
      title = rec.note || incomeLabel(rec.sourceType) || 'Income'
      subtitle = rec.note ? incomeLabel(rec.sourceType) : ''
      break
    case 'transfer-out':
      title = `Transfer to ${accountName(rec.toAccountId)}`
      subtitle = rec.note || ''
      break
    case 'transfer-in':
      title = `Transfer from ${accountName(rec.fromAccountId)}`
      subtitle = rec.note || ''
      break
    case 'correction':
      title = 'Balance correction'
      subtitle = rec.note || ''
      break
    // Lending (managed on the Lending page): shown for the balance, never counted as spending or income.
    case 'loan-out':
      title = `Loan to ${rec.personName || rec.borrowerName || 'someone'}`
      subtitle = rec.notes || ''
      break
    case 'loan-in':
      title = `Loan from ${rec.personName || rec.borrowerName || 'someone'}`
      subtitle = rec.notes || ''
      break
    case 'repayment-in':
      title = `Repayment from ${rec.personName || 'someone'}`
      subtitle = rec.notes || ''
      break
    case 'repayment-out':
      title = `Repayment to ${rec.personName || 'someone'}`
      subtitle = rec.notes || ''
      break
    // Investments (managed on the Investments page): shown for the balance, never counted as spending or income.
    case 'investment-out':
      title = `Contribution to ${rec.fundName || 'a fund'}`
      subtitle = rec.notes || ''
      break
    case 'investment-in':
      title = `Withdrawal from ${rec.fundName || 'a fund'}`
      subtitle = rec.notes || ''
      break
    default:
      title = ROW_LABELS.opening
  }
  const amountC = cents(row.amount)
  return {
    ...row,
    label: ROW_LABELS[row.type] || 'Entry',
    title,
    subtitle,
    sign: row.type === 'opening' ? '' : amountC > 0 ? '+' : amountC < 0 ? '−' : '',
    editable: row.type === 'transfer-in' || row.type === 'transfer-out',
    deletable: row.type === 'transfer-in' || row.type === 'transfer-out' || row.type === 'correction',
    reconciledTo: row.type === 'correction' && rec.reconciledTo !== null && rec.reconciledTo !== undefined ? Number(rec.reconciledTo) : null,
  }
}

/**
 * The detail page for one account: balance, the ledger grouped by LOCAL day NEWEST first (within a day, the latest
 * entry first), the opening row, and the warnings. Running balances come from the pure ledger, never recomputed here.
 * Returns { balance (accountBalance result), groups: [{ dayKey, net, scheduled, items }], opening, rowCount,
 *           scheduledCount, olderThanOpening }.
 */
export function ledgerView(account, store, data = {}, { now = new Date(), lookups = {} } = {}) {
  const full = { ...data, transfers: (store && store.transfers) || [], adjustments: (store && store.adjustments) || [] }
  const balance = accountBalance(account, full, { now })
  const rows = accountLedger(account, full, { now, includeScheduled: true })
  const opening = describeRow(rows[0], lookups)
  const groups = []
  let scheduledCount = 0
  for (const row of rows.slice(1).reverse()) {
    const d = describeRow(row, lookups)
    if (d.scheduled) scheduledCount++
    let g = groups[groups.length - 1]
    if (!g || g.dayKey !== d.dayKey) {
      g = { dayKey: d.dayKey, netC: 0, scheduled: d.scheduled, items: [] }
      groups.push(g)
    }
    g.items.push(d)
    g.netC += cents(d.amount)
  }
  return {
    balance,
    opening,
    groups: groups.map(({ netC, ...g }) => ({ ...g, net: fromCents(netC) })),
    rowCount: rows.length - 1,
    scheduledCount,
    olderThanOpening: balance.olderThanOpening,
  }
}

/** Show whole day-groups until at least `maxRows` entries are visible (a day is never cut in half). */
export function limitGroups(groups, maxRows) {
  const out = []
  let shown = 0
  for (const g of groups) {
    if (shown >= maxRows) break
    out.push(g)
    shown += g.items.length
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return { groups: out, shown, total, hasMore: shown < total }
}

// ---- transfer form ---------------------------------------------------------------------------------------------------

/** Accounts offered in a transfer's From/To lists: the active ones, plus any archived account already used by the transfer being edited. */
export function transferChoices(store, keepIds = []) {
  const keep = new Set(keepIds.filter(Boolean))
  return ((store && store.accounts) || []).filter((a) => !a.archived || keep.has(a.id)).sort(byOrderThenName)
}

/** Sensible From/To for a new transfer: From = the preferred account (else the first active); To = the first OTHER active account. */
export function defaultTransferPair(store, preferredFromId = '') {
  const active = transferChoices(store)
  const from = active.find((a) => a.id === preferredFromId) || active[0] || null
  const to = active.find((a) => a.id !== from?.id) || null
  return { fromAccountId: from?.id || '', toAccountId: to?.id || '' }
}

// ---- reconcile dialog ------------------------------------------------------------------------------------------------

/**
 * Live preview for the reconcile dialog. Never throws on bad typing: returns { valid: false, error } instead.
 * With valid input: { valid: true, asOf, expected, actual, difference, needsCorrection, direction: 'match'|'higher'|'lower',
 * message, hint }. `format(n)` turns a number into money text.
 */
export function reconcileView(account, store, data = {}, { actual, asOf, now = new Date(), format = (n) => String(n) } = {}) {
  const today = localDayKey(now)
  const day = asOf === undefined || asOf === null || asOf === '' ? today : asOf
  if (actual === '' || actual === null || actual === undefined || !Number.isFinite(Number(actual))) return { valid: false, error: 'Enter the real balance as a number' }
  if (!isDayKey(day)) return { valid: false, error: 'Pick a valid day' }
  if (day > today) return { valid: false, error: 'Pick today or an earlier day' }
  if (day < account.openingDate) return { valid: false, error: `That day is before the account's opening date (${formatDayKey(account.openingDate)})` }
  const full = { ...data, transfers: (store && store.transfers) || [], adjustments: (store && store.adjustments) || [] }
  const r = reconcileDifference(account, full, { actual, asOf: day, now })
  const direction = !r.needsCorrection ? 'match' : r.difference > 0 ? 'higher' : 'lower'
  let message
  let hint = ''
  if (direction === 'match') {
    message = 'This matches what the app calculates. No correction is needed.'
  } else {
    const gap = format(Math.abs(r.difference))
    message =
      direction === 'higher'
        ? `Your real balance is ${gap} higher than the app calculates. A correction of +${gap} will be added.`
        : `Your real balance is ${gap} lower than the app calculates. A correction of −${gap} will be added.`
    hint = 'A big difference usually means a missing transaction. Check your records first; a correction is a last resort.'
    const u = unassignedSummary(store, data, account.openingDate)
    if (u.count) hint += ` ${u.text.charAt(0).toUpperCase()}${u.text.slice(1)}; one of them may belong here.`
  }
  return { valid: true, ...r, direction, message, hint }
}

// ---- account picker in the expense / income forms (Phase 2.4) ---------------------------------------------------------

/**
 * The accounts offered by the picker: the active ones in their order, plus `keepId` (the record's current account) even
 * if it is archived, so editing an old record never silently drops its account. Empty when no account exists, and the
 * form then hides the picker entirely (today's fast entry is unchanged until the first account is created).
 */
export function accountPickerChoices(store, keepId = '') {
  const accounts = (store && store.accounts) || []
  if (!accounts.length) return []
  return accounts.filter((a) => !a.archived || a.id === keepId).sort(byOrderThenName)
}

/**
 * Which account the form starts on. Edit mode: the record's own account if it still exists, else none (Unassigned).
 * Create mode: the last account used if it is still active, else the default account if active, else none.
 */
export function initialAccountId(store, { mode = 'create', current = '', lastAccountId = '', defaultAccountId = '' } = {}) {
  const accounts = (store && store.accounts) || []
  if (mode === 'edit') return accounts.some((a) => a.id === current) ? current : ''
  const active = (id) => (id && accounts.some((a) => a.id === id && !a.archived) ? id : '')
  return active(lastAccountId) || active(defaultAccountId) || ''
}

// ---- bulk assign (Expenses page) --------------------------------------------------------------------------------------

/**
 * What "assign account X to these records" would change, without changing anything. `accountId` '' means "remove the
 * account". Records that already have that account are skipped. Used for the confirmation text and for Undo.
 * Returns { changes: [{ id, from, to }], count, unchanged }.
 */
export function assignmentPlan(records, ids, accountId, store = null) {
  const wanted = new Set(ids || [])
  const to = accountId || ''
  const known = store ? new Set(((store && store.accounts) || []).map((a) => a.id)) : null
  const changes = []
  let unchanged = 0
  for (const r of records || []) {
    if (!r || !wanted.has(r.id)) continue
    // an id that is not a real account counts as "no account" (it is Unassigned), so "remove" leaves it alone only when truly empty
    const from = r.accountId || ''
    const effectiveFrom = known && from && !known.has(from) ? '' : from
    if (from === to || (effectiveFrom === '' && to === '' && !from)) {
      unchanged++
      continue
    }
    changes.push({ id: r.id, from, to })
  }
  return { changes, count: changes.length, unchanged }
}

/**
 * The account a record created without a form (a confirmed recurring expense) should use: the preferred account (the
 * template's own) if it exists and is not archived, else the default account if usable, else none (Unassigned).
 */
export function accountForNewRecord(store, { preferredId = '', defaultAccountId = '' } = {}) {
  const accounts = (store && store.accounts) || []
  const usable = (id) => (id && accounts.some((a) => a.id === id && !a.archived) ? id : '')
  return usable(preferredId) || usable(defaultAccountId) || ''
}
