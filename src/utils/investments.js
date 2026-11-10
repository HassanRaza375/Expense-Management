// ---------------------------------------------------------------------------
// Investment performance (Phase 4). Pure: no Vue, no storage. Depends only on reporting.js for local day keys.
//
// A fund is { contributions: [{date, amount}], withdrawals?: [{date, amount}], valueEntries: [{date, value}] }.
// `withdrawals` is new and optional: a fund WITHOUT withdrawals gets exactly the figures the app showed before
// (currentValue = latest value entry, else total invested; profit = value - invested; return % = profit / invested).
//
// WITH withdrawals:
//   - currentValue  = the latest value entry MINUS withdrawals made after that entry (money that left the fund is no
//                     longer in it), never below 0. With no value entry at all: contributions - withdrawals.
//   - realized gain = for each withdrawal, average cost method: the share of the holding that was sold
//                     (amount / estimated value just before the withdrawal) carries that share of the cost basis;
//                     realized += amount - cost removed.
//   - unrealized    = currentValue - remaining cost basis.
//   - total gain    = realized + unrealized;  return % = total gain / total contributed.
// Contributions made after the latest value entry are NOT added to currentValue (the owner's documented choice: profit
// dips by the top-up until the next value update); they ARE added to the cost basis, exactly as before.
// Events are processed in time order (instant, then createdAt), so same-day entries follow the order they were entered.
// All sums use integer cents.
// ---------------------------------------------------------------------------
import { localDayKey, isDayKey } from './reporting.js'

const toCents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fromCents = (c) => c / 100
const instant = (r) => {
  const t = new Date(r?.date).getTime()
  return Number.isNaN(t) ? 0 : t
}
const created = (r) => {
  const t = new Date(r?.createdAt).getTime()
  return Number.isNaN(t) ? 0 : t
}
const byTime = (a, b) => instant(a) - instant(b) || created(a) - created(b) || String(a?.id).localeCompare(String(b?.id))
// a list of records, with anything that is not an object (null, a number, ...) dropped so one bad entry cannot break the maths
const list = (x) => (Array.isArray(x) ? x.filter((r) => r !== null && typeof r === 'object') : [])

/** Events of a fund in time order: [{ kind: 'contribution' | 'withdrawal' | 'value', record }]. */
function events(fund) {
  const out = []
  for (const c of list(fund?.contributions)) out.push({ kind: 'contribution', record: c })
  for (const w of list(fund?.withdrawals)) out.push({ kind: 'withdrawal', record: w })
  for (const v of list(fund?.valueEntries)) out.push({ kind: 'value', record: v })
  return out.sort((a, b) => byTime(a.record, b.record))
}

/**
 * Everything about one fund up to and including `asOf` (a day key; default = everything).
 * Returns { invested, withdrawn, netInvested, currentValue, hasValueEntry, costBasis, realizedGain, unrealizedGain,
 *           totalGain, returnPct } in currency units. returnPct is null when nothing was ever contributed.
 */
export function performance(fund, { asOf = null } = {}) {
  if (asOf !== null && !isDayKey(asOf)) throw new RangeError('asOf must be a day (YYYY-MM-DD) or null')
  const within = (r) => asOf === null || (localDayKey(r?.date) !== null && localDayKey(r.date) <= asOf)
  let investedC = 0
  let withdrawnC = 0
  let costC = 0 // remaining cost basis
  let estC = 0 // estimated value, used only to size a withdrawal's share of the holding
  let realizedC = 0
  let lastEntry = null
  let lastEntryIndex = -1
  let withdrawnAfterEntryC = 0
  let contributedAfterEntryC = 0

  const seq = events(fund).filter((e) => within(e.record))
  seq.forEach((e, i) => {
    const amountC = toCents(e.record.amount)
    if (e.kind === 'contribution') {
      investedC += amountC
      costC += amountC
      estC += amountC
      contributedAfterEntryC += amountC
    } else if (e.kind === 'value') {
      lastEntry = e.record
      lastEntryIndex = i
      estC = toCents(e.record.value)
      withdrawnAfterEntryC = 0
      contributedAfterEntryC = 0
    } else {
      withdrawnC += amountC
      let removedC
      if (estC > 0) removedC = Math.round(costC * Math.min(1, amountC / estC))
      else removedC = Math.min(costC, amountC) // no value information: treat the money as coming out of cost first
      realizedC += amountC - removedC
      costC -= removedC
      estC = Math.max(0, estC - amountC)
      withdrawnAfterEntryC += amountC
    }
  })

  const hasValueEntry = lastEntry !== null
  const currentC = hasValueEntry ? Math.max(0, toCents(lastEntry.value) - withdrawnAfterEntryC) : Math.max(0, investedC - withdrawnC)
  const unrealizedC = currentC - costC
  const totalC = realizedC + unrealizedC
  return {
    invested: fromCents(investedC),
    withdrawn: fromCents(withdrawnC),
    netInvested: fromCents(investedC - withdrawnC),
    currentValue: fromCents(currentC),
    hasValueEntry,
    costBasis: fromCents(costC),
    realizedGain: fromCents(realizedC),
    unrealizedGain: fromCents(unrealizedC),
    totalGain: fromCents(totalC),
    returnPct: investedC > 0 ? (totalC / investedC) * 100 : null,
  }
}

/** The fund's value on a given day (what net worth uses). */
export function valueAt(fund, dayKey) {
  return performance(fund, { asOf: dayKey }).currentValue
}

/**
 * Points for the fund chart: one per distinct day with an event, oldest first:
 * [{ dayKey, value, netInvested }]. `value` is the fund's value that day, `netInvested` contributions minus withdrawals.
 */
export function fundSeries(fund) {
  const days = new Set()
  for (const e of events(fund)) {
    const k = localDayKey(e.record.date)
    if (k !== null) days.add(k)
  }
  return [...days].sort().map((dayKey) => {
    const p = performance(fund, { asOf: dayKey })
    return { dayKey, value: p.currentValue, netInvested: p.netInvested }
  })
}

/** Totals across funds. Returns the same fields as performance() summed (returnPct recomputed from the totals). */
export function portfolioPerformance(funds, { asOf = null } = {}) {
  const sum = { invested: 0, withdrawn: 0, netInvested: 0, currentValue: 0, costBasis: 0, realizedGain: 0, unrealizedGain: 0, totalGain: 0 }
  const c = Object.fromEntries(Object.keys(sum).map((k) => [k, 0]))
  for (const f of list(funds)) {
    const p = performance(f, { asOf })
    for (const k of Object.keys(sum)) c[k] += toCents(p[k])
  }
  for (const k of Object.keys(sum)) sum[k] = fromCents(c[k])
  return { ...sum, returnPct: c.invested > 0 ? (c.totalGain / c.invested) * 100 : null }
}
