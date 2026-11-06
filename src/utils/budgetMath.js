// ---------------------------------------------------------------------------
// Budget math (pure: no Vue, no storage). Depends only on reporting.js.
//
// Everything is computed from the RAW transaction lists passed in, never from other summaries, so the
// Dashboard, the Budget page and the Expenses page always show the same figure for the same cycle:
//
//     spent = (sum of ordinary expenses) - (sum of refunds)      for the cycle's local days
//
// NEGATIVE / ZERO CATEGORIES (refunds exceed spending in a category, or the whole cycle):
//   * the REAL number is always reported (spent can be negative, remaining can exceed the budget);
//   * the progress bar is clamped (barPercent 0..100) and the status is 'good', never 'over';
//   * a category with no budget and net <= 0 shows 0% (a category with net > 0 and no budget keeps the
//     original behaviour: 100% / 'warn').
// ---------------------------------------------------------------------------
import { localDayKey, cycleContaining, adjacentCycle, filterTransactions, summarize, categoryBreakdown, groupByDay, diffDays, parseDayKey, resolveFilters } from './reporting.js'

/** >100% over budget, >=80% warning, otherwise good (unchanged from the original useBudget). */
export function statusForPercent(percent) {
  if (percent > 100) return 'over'
  if (percent >= 80) return 'warn'
  return 'good'
}

/** A usable reset day (1-31) from whatever is stored in settings; falls back to 6. */
export function sanitizeResetDay(value, fallback = 6) {
  const n = Math.trunc(Number(value))
  return n >= 1 && n <= 31 ? n : fallback
}

/**
 * Adapter for code that still wants Date objects (CycleRail, recurring confirmations): local midnight of
 * the first day and 23:59:59.999 of the last day. For reset days 1-28 these are EXACTLY the Dates the old
 * getCycle() produced (recurring items persist `start.toISOString().slice(0, 10)`, so this must not drift).
 */
export function toDateCycle(range) {
  const a = parseDayKey(range.startKey)
  const b = parseDayKey(range.endKey)
  return { start: new Date(a.y, a.m - 1, a.d, 0, 0, 0, 0), end: new Date(b.y, b.m - 1, b.d, 23, 59, 59, 999) }
}

/**
 * Where `todayKey` falls in the cycle { startKey, endKey }, by whole LOCAL days (calendar math on day keys, never a
 * difference of milliseconds, so a 23- or 25-hour DST day cannot shift the count).
 *   total   = days in the cycle
 *   elapsed = which day of the cycle it is (1 on the first day), clamped into 1..total
 *   left    = days left INCLUDING today (the last day has 1)
 */
export function cycleDayProgress(range, todayKey) {
  const total = diffDays(range.startKey, range.endKey) + 1
  const elapsed = Math.min(Math.max(diffDays(range.startKey, todayKey) + 1, 1), total)
  return { total, elapsed, left: total - elapsed + 1 }
}

/** Net income (income records have no refunds) dated inside the cycle { startKey, endKey }. */
export function cycleIncome(income, cycle) {
  return summarize(filterTransactions(income, { cycle })).net
}

/**
 * What the Income page shows. mode: 'this' (current cycle) | 'last' (previous cycle) | 'all'.
 * Returns { range, list, groups (by LOCAL day, newest first), total, count }. `total` is the same function the Dashboard's
 * "Income this cycle" uses, so the two can never disagree.
 */
export function incomeOverview(income, { mode = 'this', now = new Date(), resetDay = 6 } = {}) {
  const cycle = mode === 'this' ? 'current' : mode === 'last' ? 'previous' : null
  const range = resolveFilters({ cycle, now, resetDay })
  const list = filterTransactions(income, { cycle, now, resetDay })
  return { range, list, groups: groupByDay(list), total: summarize(list).net, count: list.length }
}

const round2 = (n) => Math.round(n * 100) / 100
const clamp01 = (n) => Math.min(Math.max(n, 0), 100)

/**
 * Everything the Dashboard and Budget pages need for the cycle that contains `now`.
 *
 * @param expenses        raw expense/refund records
 * @param income          raw income records
 * @param overallBudget   settings.overallBudget
 * @param categoryBudgets settings.categoryBudgets ({ [categoryId]: number })
 * @param categories      [{ id, ... }] in display order
 * @param resetDay        1-31
 */
export function computeBudget({ expenses = [], income = [], overallBudget = 0, categoryBudgets = {}, categories = [], resetDay = 6, now = new Date() } = {}) {
  const today = localDayKey(now)
  if (today === null) throw new TypeError('Invalid "now" date')
  const cycle = cycleContaining(today, resetDay)
  const previous = adjacentCycle(cycle, resetDay, -1)

  const cycleList = filterTransactions(expenses, { cycle })
  const previousList = filterTransactions(expenses, { cycle: previous })
  const summary = summarize(cycleList, { range: { ...cycle, empty: false }, now })
  const previousSpent = summarize(previousList).net
  const spent = summary.net

  // `left` counts today (the last day of a cycle has 1 left). That is what the original dashboard showed (its cycle
  // length was one day too long), so "Safe to spend / day" = remaining / left keeps the same meaning.
  const { total: totalDays, elapsed, left } = cycleDayProgress(cycle, today)

  const budget = Number(overallBudget) || 0
  const remaining = round2(budget - spent)
  const percentUsed = budget ? (spent / budget) * 100 : 0
  const status = budget ? statusForPercent(percentUsed) : 'good'
  const safeToSpendPerDay = left <= 0 ? Math.max(remaining, 0) : remaining / left

  const byCategory = new Map(categoryBreakdown(cycleList).map((c) => [c.categoryId, c]))
  const rows = (categories || [])
    .map((cat) => {
      const row = byCategory.get(cat.id)
      const catSpent = row ? row.net : 0
      const catBudget = Number(categoryBudgets?.[cat.id]) || 0
      const pct = catBudget ? (catSpent / catBudget) * 100 : catSpent > 0 ? 100 : 0
      return {
        categoryId: cat.id,
        spent: catSpent,
        gross: row ? row.gross : 0,
        refunds: row ? row.refunds : 0,
        count: row ? row.count : 0,
        budget: catBudget,
        remaining: round2(catBudget - catSpent),
        percentUsed: pct,
        barPercent: clamp01(pct),
        status: statusForPercent(pct),
      }
    })
    .sort((a, b) => b.percentUsed - a.percentUsed)

  // Spending in categories that are not in `categories` (e.g. deleted ones) so the rows always reconcile to `spent`.
  const listedC = rows.reduce((s, r) => s + Math.round(r.spent * 100), 0)
  const unlistedSpent = round2(Math.round(spent * 100) / 100 - listedC / 100)

  const topCategory = rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent)[0] || null

  let highestSpendDay = null
  for (const g of groupByDay(cycleList)) {
    if (g.dayKey !== null && g.net > 0 && (!highestSpendDay || g.net > highestSpendDay.total)) highestSpendDay = { day: g.dayKey, total: g.net }
  }

  const incomeNet = cycleIncome(income, cycle)
  const netCashflow = round2(incomeNet - spent)
  const savingsRate = incomeNet > 0 ? (netCashflow / incomeNet) * 100 : 0

  const cycleOverCycleChange = previousSpent > 0 ? ((spent - previousSpent) / previousSpent) * 100 : spent > 0 ? 100 : 0

  const alerts = []
  if (percentUsed >= 100) alerts.push({ scope: 'overall', level: 'over', message: 'Over overall budget' })
  else if (percentUsed >= 80) alerts.push({ scope: 'overall', level: 'warn', message: 'Nearing overall budget' })
  for (const r of rows) {
    if (!r.budget) continue
    const name = categories.find((c) => c.id === r.categoryId)?.name || 'Category'
    if (r.percentUsed >= 100) alerts.push({ scope: r.categoryId, level: 'over', message: `${name} over budget` })
    else if (r.percentUsed >= 80) alerts.push({ scope: r.categoryId, level: 'warn', message: `${name} nearing budget` })
  }

  return {
    cycle,
    previousCycle: previous,
    cycleList,
    days: { total: totalDays, elapsed, left },
    spent,
    gross: summary.gross,
    refunds: summary.refunds,
    count: summary.count,
    previousSpent,
    remaining,
    percentUsed,
    barPercent: clamp01(percentUsed),
    status,
    safeToSpendPerDay,
    categories: rows,
    unlistedSpent,
    topCategory,
    biggestExpense: summary.largest,
    dailyAverage: summary.dailyAverage,
    highestSpendDay,
    cycleIncome: incomeNet,
    netCashflow,
    savingsRate,
    cycleOverCycleChange,
    alerts,
  }
}
