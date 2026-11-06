// ---------------------------------------------------------------------------
// Accounts (Phase 2.1). Pure: no Vue, no storage; depends only on reporting.js. Balances are COMPUTED from the raw
// records every time (no stored running balance), in integer cents, attributed by LOCAL day.
//
//   balance(account, asOf) = opening
//                            + income         assigned to the account
//                            + refunds        assigned to the account
//                            - expenses       assigned to the account
//                            + transfers in   - transfers out
//                            + corrections    (reconciliation adjustments)
//   counting only records dated from the account's opening DAY (inclusive: the opening balance is the balance at the
//   START of that day) up to `asOf` (inclusive, default today).
//
// Records with no `accountId`, or an id that is not an account, are UNASSIGNED: they never touch any balance.
// Records older than an account's opening day are ignored for its balance (the opening balance already contains
// them) but counted so the UI can flag them. Records after `asOf` are "scheduled", not counted yet.
// Transfers and corrections are NOT transactions: nothing here changes any budget or report figure.
// ---------------------------------------------------------------------------
import { localDayKey, isDayKey } from './reporting.js'

export const ACCOUNT_TYPES = ['cash', 'bank', 'wallet', 'card', 'other']
export const ACCOUNT_TYPE_LABELS = { cash: 'Cash', bank: 'Bank account', wallet: 'Mobile wallet', card: 'Credit card', other: 'Other' }

const toCents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fromCents = (c) => c / 100
const amountC = (record) => toCents(record?.amount) // a record's amount, in cents
const isRefund = (t) => t?.kind === 'refund'
const createdMs = (r) => {
  const ms = new Date(r?.createdAt).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function asOfKey(asOf, now) {
  if (asOf === undefined || asOf === null || asOf === '') {
    const key = localDayKey(now)
    if (key === null) throw new TypeError('Invalid "now" date')
    return key
  }
  if (isDayKey(asOf)) return asOf
  const key = localDayKey(asOf)
  if (key === null) throw new TypeError('Invalid "asOf" date')
  return key
}

/**
 * Everything about one account's balance.
 * data = { expenses, income, transfers, adjustments } (any may be missing).
 * Returns { accountId, balance, opening, income, refunds, expenses, transfersIn, transfersOut, corrections, asOf,
 *           counted, olderThanOpening, scheduled, unreadable } (money in currency units).
 */
export function accountBalance(account, data = {}, { asOf, now = new Date() } = {}) {
  if (!account || !isDayKey(account.openingDate)) throw new RangeError('An account needs a valid openingDate (YYYY-MM-DD)')
  const through = asOfKey(asOf, now)
  const open = account.openingDate
  const id = account.id
  const sum = { income: 0, refunds: 0, expenses: 0, transfersIn: 0, transfersOut: 0, corrections: 0 }
  const n = { counted: 0, olderThanOpening: 0, scheduled: 0, unreadable: 0 }

  // Classifies a record's day relative to this account; returns true when it should be counted.
  const counts = (record) => {
    const day = localDayKey(record?.date)
    if (day === null) {
      n.unreadable++
      return false
    }
    if (day < open) {
      n.olderThanOpening++
      return false
    }
    if (day > through) {
      n.scheduled++
      return false
    }
    n.counted++
    return true
  }

  for (const e of data.expenses || []) {
    if (e?.accountId !== id || !counts(e)) continue
    if (isRefund(e)) sum.refunds += amountC(e)
    else sum.expenses += amountC(e)
  }
  for (const i of data.income || []) {
    if (i?.accountId !== id || !counts(i)) continue
    sum.income += amountC(i)
  }
  for (const t of data.transfers || []) {
    if (t?.fromAccountId === t?.toAccountId) continue // a transfer to itself moves nothing
    const out = t?.fromAccountId === id
    const into = t?.toAccountId === id
    if ((!out && !into) || !counts(t)) continue
    if (out) sum.transfersOut += amountC(t)
    else sum.transfersIn += amountC(t)
  }
  for (const a of data.adjustments || []) {
    if (a?.accountId !== id || !counts(a)) continue
    sum.corrections += amountC(a) // signed
  }

  const openingC = toCents(account.openingBalance)
  const balanceC = openingC + sum.income + sum.refunds - sum.expenses + sum.transfersIn - sum.transfersOut + sum.corrections
  return {
    accountId: id,
    balance: fromCents(balanceC),
    opening: fromCents(openingC),
    income: fromCents(sum.income),
    refunds: fromCents(sum.refunds),
    expenses: fromCents(sum.expenses),
    transfersIn: fromCents(sum.transfersIn),
    transfersOut: fromCents(sum.transfersOut),
    corrections: fromCents(sum.corrections),
    asOf: through,
    ...n,
  }
}

/**
 * Balances of every account plus totals. store = { accounts, transfers, adjustments }.
 * `total` adds the signed balances of NON-archived accounts (a credit card's debt subtracts); `byType` splits it.
 */
export function accountsOverview(store, data = {}, opts = {}) {
  const accounts = (store && store.accounts) || []
  const full = { ...data, transfers: (store && store.transfers) || [], adjustments: (store && store.adjustments) || [] }
  const balances = {}
  const byTypeC = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, 0]))
  let totalC = 0
  let totalAllC = 0
  for (const account of accounts) {
    const b = accountBalance(account, full, opts)
    balances[account.id] = b
    const c = toCents(b.balance)
    totalAllC += c
    if (!account.archived) {
      totalC += c
      byTypeC[ACCOUNT_TYPES.includes(account.type) ? account.type : 'other'] += c
    }
  }
  return {
    balances,
    total: fromCents(totalC),
    totalIncludingArchived: fromCents(totalAllC),
    byType: Object.fromEntries(Object.entries(byTypeC).map(([k, v]) => [k, fromCents(v)])),
  }
}

/**
 * Chronological ledger rows for one account: the opening row, then every counted record, each with the signed effect
 * on the balance and the running balance. Rows: { id, type, dayKey, date, amount, running, scheduled, note, record }
 * where type is 'opening' | 'expense' | 'refund' | 'income' | 'transfer-in' | 'transfer-out' | 'correction'.
 * With includeScheduled, future-dated records are appended (flagged `scheduled`, running balance continues).
 * The last non-scheduled row's `running` always equals accountBalance(...).balance.
 */
export function accountLedger(account, data = {}, { asOf, now = new Date(), includeScheduled = false } = {}) {
  if (!account || !isDayKey(account.openingDate)) throw new RangeError('An account needs a valid openingDate (YYYY-MM-DD)')
  const through = asOfKey(asOf, now)
  const open = account.openingDate
  const id = account.id
  const items = []
  const add = (record, type, effectC) => {
    const day = localDayKey(record?.date)
    if (day === null || day < open) return
    const scheduled = day > through
    if (scheduled && !includeScheduled) return
    items.push({ record, type, day, effectC, scheduled })
  }
  for (const e of data.expenses || []) {
    if (e?.accountId !== id) continue
    add(e, isRefund(e) ? 'refund' : 'expense', isRefund(e) ? amountC(e) : -amountC(e))
  }
  for (const i of data.income || []) {
    if (i?.accountId === id) add(i, 'income', amountC(i))
  }
  for (const t of data.transfers || []) {
    if (t?.fromAccountId === t?.toAccountId) continue
    if (t?.fromAccountId === id) add(t, 'transfer-out', -amountC(t))
    else if (t?.toAccountId === id) add(t, 'transfer-in', amountC(t))
  }
  for (const a of data.adjustments || []) {
    if (a?.accountId === id) add(a, 'correction', amountC(a))
  }
  items.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : createdMs(a.record) - createdMs(b.record) || String(a.record?.id).localeCompare(String(b.record?.id))))

  let running = toCents(account.openingBalance)
  const rows = [{ id: `opening-${id}`, type: 'opening', dayKey: open, date: null, amount: fromCents(running), running: fromCents(running), scheduled: false, note: 'Opening balance', record: null }]
  for (const it of items) {
    running += it.effectC
    rows.push({ id: it.record?.id, type: it.type, dayKey: it.day, date: it.record?.date ?? null, amount: fromCents(it.effectC), running: fromCents(running), scheduled: it.scheduled, note: it.record?.note || '', record: it.record })
  }
  return rows
}

/**
 * Expenses/refunds and income dated on or after `sinceKey` that have no account (or an id that is not an account).
 * Returns { since, expenses, income, count }.
 */
export function unassignedSince(store, data = {}, sinceKey) {
  const known = new Set(((store && store.accounts) || []).map((a) => a.id))
  const ok = (r) => r?.accountId && known.has(r.accountId)
  const late = (r) => {
    const d = localDayKey(r?.date)
    return d !== null && (!sinceKey || d >= sinceKey)
  }
  const expenses = (data.expenses || []).filter((r) => !ok(r) && late(r))
  const income = (data.income || []).filter((r) => !ok(r) && late(r))
  return { since: sinceKey || null, expenses, income, count: expenses.length + income.length }
}

/**
 * Reconciliation: the user enters the REAL balance. Returns { asOf, expected, actual, difference, needsCorrection }
 * where difference = actual - expected (exact, in cents).
 */
export function reconcileDifference(account, data = {}, { actual, asOf, now = new Date() } = {}) {
  const n = Number(actual)
  if (actual === '' || actual === null || actual === undefined || !Number.isFinite(n)) throw new TypeError('Enter the actual balance as a number')
  const b = accountBalance(account, data, { asOf, now })
  const diffC = toCents(n) - toCents(b.balance)
  return { asOf: b.asOf, expected: b.balance, actual: fromCents(toCents(n)), difference: fromCents(diffC), needsCorrection: diffC !== 0 }
}

// ---- validation (return lists of human-readable problems; empty = valid) ----------------------------------------

export function validateAccount(input, { accounts = [], excludeId = null } = {}) {
  const errors = []
  const name = String(input?.name ?? '').trim()
  if (!name) errors.push('Account name is required')
  else if (accounts.some((a) => a.id !== excludeId && String(a.name).trim().toLowerCase() === name.toLowerCase())) errors.push('An account with this name already exists')
  if (!ACCOUNT_TYPES.includes(input?.type)) errors.push('Choose an account type')
  if (!Number.isFinite(Number(input?.openingBalance)) || input?.openingBalance === '' || input?.openingBalance === null) errors.push('Opening balance must be a number')
  if (!isDayKey(input?.openingDate)) errors.push('Opening balance date must be a valid day (YYYY-MM-DD)')
  return errors
}

export function validateTransfer(store, t, { requireActive = true } = {}) {
  const errors = []
  const accounts = (store && store.accounts) || []
  const from = accounts.find((a) => a.id === t?.fromAccountId)
  const to = accounts.find((a) => a.id === t?.toAccountId)
  if (!from) errors.push('Choose the account the money comes from')
  if (!to) errors.push('Choose the account the money goes to')
  if (from && to && from.id === to.id) errors.push('The two accounts must be different')
  if (requireActive && ((from && from.archived) || (to && to.archived))) errors.push('An archived account cannot be used in a new transfer')
  if (!(Number(t?.amount) > 0)) errors.push('Amount must be greater than 0')
  if (localDayKey(t?.date) === null) errors.push('Pick a valid date')
  return errors
}

export function validateAdjustment(store, a) {
  const errors = []
  const accounts = (store && store.accounts) || []
  if (!accounts.some((x) => x.id === a?.accountId)) errors.push('Choose the account to correct')
  const amount = Number(a?.amount)
  if (!Number.isFinite(amount) || toCents(amount) === 0) errors.push('A correction must be a non-zero amount')
  if (localDayKey(a?.date) === null) errors.push('Pick a valid date')
  return errors
}

// ---- display rule ---------------------------------------------------------------------------------------------

/**
 * How a balance should be described. Balances are stored asset-positive; a credit card's negative balance is shown as
 * "Owed", never as an error. A negative cash/bank/wallet balance is allowed but gets a gentle hint.
 * Returns { label, amount (absolute), signed, tone: 'neutral'|'warn', hint }.
 */
export function balanceDisplay(account, balance) {
  const signed = fromCents(toCents(balance))
  const amount = Math.abs(signed)
  if (account?.type === 'card') {
    if (signed < 0) return { label: 'Owed', amount, signed, tone: 'neutral', hint: '' }
    if (signed > 0) return { label: 'In credit', amount, signed, tone: 'neutral', hint: '' }
    return { label: 'Paid off', amount: 0, signed: 0, tone: 'neutral', hint: '' }
  }
  if (signed < 0) return { label: 'Balance', amount, signed, tone: 'warn', hint: 'Negative balance: check for missing records or add a correction' }
  return { label: 'Balance', amount, signed, tone: 'neutral', hint: '' }
}
