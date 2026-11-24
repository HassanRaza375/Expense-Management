// ---------------------------------------------------------------------------
// Financial overview (Phase 3). Pure: no Vue, no storage. Everything is computed from the raw records on demand, so
// there is no stored net-worth snapshot that could go stale, and the history is a pure function of the records.
//
//   net worth = accounts (signed balances of NON-archived accounts; a card's debt subtracts)
//             + assets            (their current value, from their purchase date on)
//             + investments       (each fund's value on that day, see utils/investments.js)
//             + money lent        (loans you made, minus repayments received)
//             - money borrowed    (loans you took, minus repayments you made)
//
// WHAT THE HISTORY CAN AND CANNOT KNOW
//   * Account balances, fund values and loan balances are exact for any past day (they come from dated records).
//   * Assets only store a CURRENT value, so an asset is valued at that figure on every day from its purchase date on
//     (or from the day it was added, when it has no purchase date).
//   * An account counts from its opening day; before that the money was not tracked.
//
// DOUBLE COUNTING: money moved from an account into a fund is counted once only if the contribution names the account
// (then the account goes down and the fund goes up). `unlinkedInvestmentCount` reports contributions after an account's
// opening day that name no account, so the page can warn about them.
// ---------------------------------------------------------------------------
import { accountBalance } from './accounts.js'
import { valueAt } from './investments.js'
import { localDayKey, isDayKey, daysInMonth, parseDayKey, adjacentCycle, filterTransactions, summarize, currentCycle } from './reporting.js'
import { cycleIncome } from './budgetMath.js'

const toCents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fromCents = (c) => c / 100
const list = (x) => (Array.isArray(x) ? x.filter((r) => r !== null && typeof r === 'object') : [])

function dayOf(value) {
  return value === null || value === undefined || value === '' ? null : localDayKey(value)
}

/**
 * Net worth on a given day.
 * inputs = { accounts: { accounts, transfers, adjustments }, expenses, income, loans, funds, assets }.
 * Returns { dayKey, total, accounts, assets, investments, receivable, payable, accountList, tracked } in currency units.
 * `tracked` is false when there is nothing at all to count on that day (so a chart can skip those days).
 */
export function netWorthAt(dayKey, inputs = {}) {
  if (!isDayKey(dayKey)) throw new RangeError('dayKey must be YYYY-MM-DD')
  const store = inputs.accounts || {}
  const data = { expenses: inputs.expenses, income: inputs.income, loans: inputs.loans, funds: inputs.funds, transfers: store.transfers, adjustments: store.adjustments }

  let accountsC = 0
  let tracked = false
  const accountList = []
  for (const account of list(store.accounts)) {
    if (account.archived) continue
    if (!isDayKey(account.openingDate) || account.openingDate > dayKey) continue
    const b = accountBalance(account, data, { asOf: dayKey })
    accountsC += toCents(b.balance)
    tracked = true
    accountList.push({ id: account.id, name: account.name, type: account.type, balance: b.balance })
  }

  let assetsC = 0
  for (const asset of list(inputs.assets)) {
    // counted from its purchase date; an asset with no purchase date is counted from the day it was added to the app
    const bought = dayOf(asset.purchaseDate) ?? dayOf(asset.createdAt)
    if (bought !== null && bought > dayKey) continue
    assetsC += toCents(asset.currentValue)
    tracked = true
  }

  let investC = 0
  for (const fund of list(inputs.funds)) {
    const v = valueAt(fund, dayKey)
    investC += toCents(v)
    const first = [...list(fund.contributions), ...list(fund.valueEntries)].map((r) => dayOf(r.date)).filter(Boolean).sort()[0]
    if (first && first <= dayKey) tracked = true
  }

  let receivableC = 0
  let payableC = 0
  for (const loan of list(inputs.loans)) {
    const made = dayOf(loan.date)
    if (made === null || made > dayKey) continue
    const repaidC = list(loan.repayments).reduce((s, r) => {
      const d = dayOf(r.date)
      return d !== null && d <= dayKey ? s + toCents(r.amount) : s
    }, 0)
    const leftC = Math.max(0, toCents(loan.amount) - repaidC)
    if (loan.direction === 'borrowed') payableC += leftC
    else receivableC += leftC
    tracked = true
  }

  return {
    dayKey,
    total: fromCents(accountsC + assetsC + investC + receivableC - payableC),
    accounts: fromCents(accountsC),
    assets: fromCents(assetsC),
    investments: fromCents(investC),
    receivable: fromCents(receivableC),
    payable: fromCents(payableC),
    accountList,
    tracked,
  }
}

/** Day key of the last day of the month containing `dayKey`. */
function endOfMonth(dayKey) {
  const { y, m } = parseDayKey(dayKey)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`
}

/**
 * Net worth at the end of each of the last `months` months (the current month ends today), oldest first, leaving out
 * the months before anything was tracked. Returns [{ dayKey, total, ...parts }].
 */
export function netWorthSeries(inputs = {}, { now = new Date(), months = 12 } = {}) {
  const today = localDayKey(now)
  if (today === null) throw new TypeError('Invalid "now" date')
  const { y, m } = parseDayKey(today)
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i
    const yy = Math.floor(total / 12)
    const mm = (total % 12) + 1
    const eom = endOfMonth(`${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01`)
    const dayKey = i === 0 ? today : eom
    const point = netWorthAt(dayKey, inputs)
    if (point.tracked) out.push(point)
  }
  return out
}

/**
 * Contributions to a fund, dated on/after the earliest opening day of an active account, that name no account:
 * the money may be counted twice (still in an account AND in the fund). Returns the count.
 */
export function unlinkedInvestmentCount(inputs = {}) {
  const opens = list((inputs.accounts || {}).accounts)
    .filter((a) => !a.archived && isDayKey(a.openingDate))
    .map((a) => a.openingDate)
    .sort()
  if (!opens.length) return 0
  const since = opens[0]
  let n = 0
  for (const fund of list(inputs.funds)) {
    for (const c of list(fund.contributions)) {
      const d = dayOf(c.date)
      if (d !== null && d >= since && !c.accountId) n++
    }
  }
  return n
}

/**
 * Cash flow for the last `cycles` budget cycles, newest first: income, spending (net of refunds), what was left and the
 * savings rate (null when there was no income). Uses the same cycle and income/spending functions as the Dashboard,
 * Budget, Income and Expenses pages, so the current cycle's numbers are identical to theirs.
 * Returns [{ startKey, endKey, income, spent, net, savingsRate, isCurrent }].
 */
export function cashFlowByCycle({ expenses = [], income = [], resetDay = 6, now = new Date(), cycles = 6 } = {}) {
  let cycle = currentCycle(now, resetDay)
  const rows = []
  for (let i = 0; i < cycles; i++) {
    const inc = cycleIncome(income, cycle)
    const spent = summarize(filterTransactions(expenses, { cycle })).net
    const net = fromCents(toCents(inc) - toCents(spent))
    rows.push({
      startKey: cycle.startKey,
      endKey: cycle.endKey,
      income: inc,
      spent,
      net,
      savingsRate: toCents(inc) > 0 ? (net / inc) * 100 : null,
      isCurrent: i === 0,
    })
    cycle = adjacentCycle(cycle, resetDay, -1)
  }
  return rows
}

