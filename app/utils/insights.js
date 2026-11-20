// ---------------------------------------------------------------------------
// Insights (Phase 5). Pure: no Vue, no storage. A short list of observations about your own records, each produced by a
// fixed, explainable rule (no guessing, no scoring model) and each saying WHY it appeared. With little data it returns
// nothing rather than something vague. All figures come from the same functions the pages use.
//
// An insight is { id, level: 'warn' | 'over' | 'info' | 'good', title, detail, to }.
//   budget-pace      spending is running ahead of (or well behind) the share of the cycle that has passed, or is over budget
//   category-spike   a category this cycle is at least 1.5x its average over the previous 3 cycles (and a real part of spending)
//   savings-rate     the last complete cycle's savings rate moved by 10+ points against the one before
//   bills-due        unpaid bills overdue or due within 7 days
//   looks-recurring  the same note and amount in 3+ different months with no recurring template for it
//   goal-behind      a goal is behind schedule or past its date
// ---------------------------------------------------------------------------
import { computeBudget } from './budgetMath.js'
import { cashFlowByCycle } from './netWorth.js'
import { localDayKey, addDays, adjacentCycle, currentCycle, filterTransactions, categoryBreakdown, summarize, isRefund } from './reporting.js'

const toCents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const list = (x) => (Array.isArray(x) ? x.filter((r) => r !== null && typeof r === 'object') : [])
const LEVEL_ORDER = { over: 0, warn: 1, info: 2, good: 3 }

/**
 * inputs = { expenses, income, resetDay, overallBudget, categoryNames: {id: name}, recurring: [templates],
 *            bills: [{ dueDate, status, amount, arrears }], goals: [{ name, status }] }
 * opts   = { now, format(n) -> money text, limit }
 */
export function buildInsights(inputs = {}, { now = new Date(), format = (n) => String(n), limit = 5 } = {}) {
  const today = localDayKey(now)
  if (today === null) throw new TypeError('Invalid "now" date')
  const out = []
  const resetDay = inputs.resetDay || 6
  const expenses = list(inputs.expenses)

  // ---- budget pace ------------------------------------------------------------------------------------------------
  const budget = computeBudget({ expenses, income: list(inputs.income), overallBudget: Number(inputs.overallBudget) || 0, categoryBudgets: {}, categories: [], resetDay, now })
  if (budget.cycleList.length && Number(inputs.overallBudget) > 0) {
    const usedPct = budget.percentUsed
    const elapsedPct = (budget.days.elapsed / budget.days.total) * 100
    if (usedPct >= 100) {
      out.push({ id: 'budget-over', level: 'over', title: 'You are over budget this cycle', detail: `You have spent ${format(budget.spent)} of a ${format(inputs.overallBudget)} budget (${Math.round(usedPct)}%).`, to: '/budget' })
    } else if (budget.days.elapsed >= 5 && usedPct - elapsedPct >= 15) {
      out.push({
        id: 'budget-pace',
        level: 'warn',
        title: 'Spending is ahead of the calendar',
        detail: `${Math.round(usedPct)}% of your budget is used but only ${Math.round(elapsedPct)}% of the cycle has passed (day ${budget.days.elapsed} of ${budget.days.total}).`,
        to: '/budget',
      })
    } else if (elapsedPct >= 50 && elapsedPct - usedPct >= 15) {
      out.push({ id: 'budget-under', level: 'good', title: 'You are under your pace', detail: `${Math.round(usedPct)}% of your budget is used with ${Math.round(elapsedPct)}% of the cycle gone.`, to: '/budget' })
    }
  }

  // ---- category spike ---------------------------------------------------------------------------------------------
  const thisCycle = currentCycle(now, resetDay)
  const thisTotalC = toCents(summarize(filterTransactions(expenses, { cycle: thisCycle })).net)
  const names = inputs.categoryNames || {}
  const now1 = breakdown(expenses, thisCycle)
  const prior = []
  let cycle = thisCycle
  for (let i = 0; i < 3; i++) {
    cycle = adjacentCycle(cycle, resetDay, -1)
    prior.push(breakdown(expenses, cycle))
  }
  const priorWithData = prior.filter((m) => m.size > 0)
  if (priorWithData.length >= 2) {
    const spikes = []
    for (const [id, nowC] of now1) {
      if (nowC <= 0) continue
      const avgC = priorWithData.reduce((s, m) => s + (m.get(id) || 0), 0) / priorWithData.length
      if (avgC > 0 && nowC >= avgC * 1.5 && nowC - avgC >= 0.1 * Math.max(thisTotalC, 1)) spikes.push({ id, nowC, avgC })
    }
    spikes.sort((a, b) => b.nowC - b.avgC - (a.nowC - a.avgC))
    for (const s of spikes.slice(0, 2)) {
      out.push({
        id: `spike-${s.id}`,
        level: 'warn',
        title: `${names[s.id] || 'A category'} is higher than usual`,
        detail: `${format(s.nowC / 100)} this cycle against an average of ${format(Math.round(s.avgC) / 100)} over your last ${priorWithData.length} cycles.`,
        to: `/expenses?cycle=current`,
      })
    }
  }

  // ---- savings rate (last two COMPLETE cycles) ---------------------------------------------------------------------
  const flow = cashFlowByCycle({ expenses, income: list(inputs.income), resetDay, now, cycles: 3 })
  const [, last, before] = flow
  if (last && before && last.savingsRate !== null && before.savingsRate !== null) {
    const delta = last.savingsRate - before.savingsRate
    if (delta <= -10) out.push({ id: 'savings-down', level: 'warn', title: 'You saved less last cycle', detail: `Last cycle you kept ${Math.round(last.savingsRate)}% of your income, down from ${Math.round(before.savingsRate)}% the cycle before.`, to: '/net-worth' })
    else if (delta >= 10) out.push({ id: 'savings-up', level: 'good', title: 'You saved more last cycle', detail: `Last cycle you kept ${Math.round(last.savingsRate)}% of your income, up from ${Math.round(before.savingsRate)}% the cycle before.`, to: '/net-worth' })
  }

  // ---- bills --------------------------------------------------------------------------------------------------------
  const soon = addDays(today, 7)
  let overdue = 0
  let due = 0
  let overdueC = 0
  let dueC = 0
  for (const b of list(inputs.bills)) {
    if (b.status === 'paid' || b.status === 'cancelled') continue
    const d = localDayKey(b.dueDate)
    if (d === null) continue
    const amountC = toCents(b.amount) + toCents(b.arrears)
    if (d < today) {
      overdue++
      overdueC += amountC
    } else if (d <= soon) {
      due++
      dueC += amountC
    }
  }
  if (overdue) out.push({ id: 'bills-overdue', level: 'over', title: overdue === 1 ? 'A bill is overdue' : `${overdue} bills are overdue`, detail: `${format(overdueC / 100)} unpaid and past the due date${due ? `, and ${format(dueC / 100)} more due this week` : ''}.`, to: '/bills' })
  else if (due) out.push({ id: 'bills-due', level: 'info', title: due === 1 ? 'A bill is due this week' : `${due} bills are due this week`, detail: `${format(dueC / 100)} in total, due within 7 days.`, to: '/bills' })

  // ---- looks recurring ----------------------------------------------------------------------------------------------
  const templateNames = new Set(list(inputs.recurring).map((t) => String(t.name || '').trim().toLowerCase()))
  const groups = new Map()
  for (const e of expenses) {
    if (isRefund(e) || e.source === 'recurring' || e.source === 'bill') continue
    const note = String(e.note || '').trim().toLowerCase()
    const day = localDayKey(e.date)
    if (note.length < 3 || day === null || !(toCents(e.amount) > 0)) continue
    const key = `${note}|${toCents(e.amount)}`
    if (!groups.has(key)) groups.set(key, { note: String(e.note).trim(), amountC: toCents(e.amount), months: new Set() })
    groups.get(key).months.add(day.slice(0, 7))
  }
  const repeats = [...groups.values()].filter((g) => g.months.size >= 3 && !templateNames.has(g.note.toLowerCase())).sort((a, b) => b.months.size - a.months.size || b.amountC - a.amountC)
  for (const g of repeats.slice(0, 1)) {
    out.push({ id: `recurring-${g.note.toLowerCase()}`, level: 'info', title: `"${g.note}" looks like a regular payment`, detail: `${format(g.amountC / 100)} in ${g.months.size} different months. You could add it as a recurring expense.`, to: '/recurring' })
  }

  // ---- goals --------------------------------------------------------------------------------------------------------
  for (const g of list(inputs.goals)) {
    if (g.status === 'behind') out.push({ id: `goal-${g.name}`, level: 'warn', title: `${g.name} is behind schedule`, detail: 'You have saved less than the share of the time that has passed.', to: '/goals' })
    else if (g.status === 'overdue') out.push({ id: `goal-${g.name}`, level: 'warn', title: `${g.name} is past its date`, detail: 'The target date has passed and the goal is not reached yet.', to: '/goals' })
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).slice(0, Math.max(0, limit))
}

// net spending per category (in cents) for one cycle; only categories that appear are in the map
function breakdown(expenses, cycle) {
  const m = new Map()
  for (const row of categoryBreakdown(filterTransactions(expenses, { cycle }))) m.set(row.categoryId, toCents(row.net))
  return m
}
