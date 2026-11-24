// Tests for src/utils/budgetMath.js and the chart-series helpers in src/utils/reporting.js.
//   * parity with the ORIGINAL budget formulas (utils/date.js + the old useBudget) for reset days 1-28
//   * refunds: spent = expenses - refunds, negative categories, reconciliation
//   * the same cycle gives the SAME net on Dashboard, Budget and Expenses
// Run: npm test   |   npm run test:tz runs this file in several time zones too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { computeBudget, toDateCycle, statusForPercent, sanitizeResetDay, cycleDayProgress } from '../app/utils/budgetMath.js'
import {
  localDayKey,
  filterTransactions,
  summarize,
  dailySeries,
  weeklySeries,
  monthlySeries,
  dayInRange,
  weekStartOf,
  formatDayKey,
  cycleContaining,
} from '../app/utils/reporting.js'
import { getCycle, getAdjacentCycle, isWithinCycle, daysElapsed, daysInCycle as legacyDaysInCycle, MS_DAY } from './legacy-cycle.mjs'

// ---- fixtures --------------------------------------------------------------
let seq = 0
const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString() // what the new forms store
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString() // a "now"-style instant
const picked = (key) => new Date(key).toISOString() // OLD date-picker format (UTC midnight)
const NOW = (y, m, d, h = 12) => new Date(y, m - 1, d, h)
const tx = (date, amount, categoryId = 'food', extra = {}) => ({ id: `t${++seq}`, date, amount, categoryId, note: '', createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...extra })
const refund = (date, amount, categoryId = 'food', extra = {}) => tx(date, amount, categoryId, { kind: 'refund', ...extra })
const cents = (n) => Math.round(n * 100)
const close = (a, b, msg, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`)
const pickerSafe = new Date('2026-11-02').getTimezoneOffset() <= 0

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CATS = [
  { id: 'food', name: 'Food' },
  { id: 'travel', name: 'Travel' },
  { id: 'gym', name: 'Gym' },
  { id: 'shop', name: 'Shopping' },
]

// ---- toDateCycle ------------------------------------------------------------

test('toDateCycle gives the exact Dates the old getCycle() did (reset days 1-28), so recurring keys stay stable', () => {
  for (let r = 1; r <= 28; r++) {
    for (let k = 0; k < 4 * 366; k += 3) {
      const date = new Date(2025, 0, 1 + k, 12)
      const old = getCycle(date, r)
      const mine = toDateCycle(cycleContaining(localDayKey(date), r))
      assert.equal(mine.start.getTime(), old.start.getTime(), `r=${r} ${localDayKey(date)} start`)
      assert.equal(mine.end.getTime(), old.end.getTime(), `r=${r} ${localDayKey(date)} end`)
      assert.equal(mine.start.toISOString().slice(0, 10), old.start.toISOString().slice(0, 10), 'the key useRecurring persists')
    }
  }
})

// ---- parity with the original useBudget -------------------------------------

// The ORIGINAL useBudget formulas, re-created from the old code (refunds did not exist then).
function oldBudget({ expenses, income, overallBudget, categoryBudgets, categories, resetDay, ref }) {
  const cycle = getCycle(ref, resetDay)
  const prev = getAdjacentCycle(cycle.start, resetDay, -1)
  const cycleExp = expenses.filter((e) => isWithinCycle(e.date, cycle))
  const spent = cycleExp.reduce((s, e) => s + e.amount, 0)
  const prevSpent = expenses.filter((e) => isWithinCycle(e.date, prev)).reduce((s, e) => s + e.amount, 0)
  const remaining = overallBudget - spent
  // The ORIGINAL days-left: its cycle length was one day too long (round(end-start)+1 on a 23:59:59.999 end),
  // which made it count TODAY as a day still to spend. computeBudget keeps that meaning on purpose.
  const left = Math.max(Math.round((cycle.end - cycle.start) / MS_DAY) + 1 - daysElapsed(cycle, ref), 0)
  const safe = left <= 0 ? Math.max(remaining, 0) : remaining / left
  const percent = overallBudget ? (spent / overallBudget) * 100 : 0
  const status = overallBudget ? statusForPercent(percent) : 'good'
  const cats = categories
    .map((cat) => {
      const s = cycleExp.filter((e) => e.categoryId === cat.id).reduce((x, e) => x + e.amount, 0)
      const b = categoryBudgets[cat.id] || 0
      const pu = b ? (s / b) * 100 : s > 0 ? 100 : 0
      return { id: cat.id, spent: s, budget: b, percentUsed: pu, status: statusForPercent(pu) }
    })
    .sort((a, b) => b.percentUsed - a.percentUsed)
  const inc = income.filter((i) => isWithinCycle(i.date, cycle)).reduce((s, i) => s + i.amount, 0)
  const alerts = []
  if (percent >= 100) alerts.push({ scope: 'overall', level: 'over' })
  else if (percent >= 80) alerts.push({ scope: 'overall', level: 'warn' })
  for (const c of cats) {
    if (!c.budget) continue
    if (c.percentUsed >= 100) alerts.push({ scope: c.id, level: 'over' })
    else if (c.percentUsed >= 80) alerts.push({ scope: c.id, level: 'warn' })
  }
  return {
    spent,
    prevSpent,
    remaining,
    left,
    safe,
    percent,
    status,
    cats,
    topId: cats.slice().sort((a, b) => b.spent - a.spent)[0]?.id,
    topSpent: cats.slice().sort((a, b) => b.spent - a.spent)[0]?.spent,
    biggest: cycleExp.reduce((m, e) => Math.max(m, e.amount), 0),
    dailyAvg: daysElapsed(cycle, ref) > 0 ? spent / daysElapsed(cycle, ref) : 0,
    income: inc,
    net: inc - spent,
    savings: inc > 0 ? ((inc - spent) / inc) * 100 : 0,
    change: prevSpent === 0 ? (spent > 0 ? 100 : 0) : ((spent - prevSpent) / prevSpent) * 100,
    alerts,
  }
}

function refundFreeData() {
  const rand = mulberry32(99)
  const ids = CATS.map((c) => c.id)
  const expenses = []
  const income = []
  for (let i = 0; i < 260; i++) {
    const off = Math.floor(rand() * 220) // Mar..Sep 2026
    expenses.push(tx(new Date(2026, 2, 1 + off, 12).toISOString(), Math.round(rand() * 400000) / 100 + 1, ids[Math.floor(rand() * ids.length)]))
  }
  for (let i = 0; i < 30; i++) income.push({ id: `i${i}`, date: new Date(2026, 2, 1 + Math.floor(rand() * 220), 12).toISOString(), amount: 50000 + Math.floor(rand() * 40000) })
  return { expenses, income }
}

test('computeBudget matches the ORIGINAL useBudget for reset days 1-28 on refund-free data', () => {
  const { expenses, income } = refundFreeData()
  const categoryBudgets = { food: 20000, travel: 5000, gym: 0 }
  let compared = 0
  // reference dates sit in a window with no DST change in any tested zone (the old daysElapsed was floor-of-milliseconds)
  for (const resetDay of [1, 2, 6, 10, 15, 20, 27, 28]) {
    for (let d = 10; d <= 80; d += 7) {
      const ref = new Date(2026, 5, d, 12) // 10 Jun .. mid Aug
      const o = oldBudget({ expenses, income, overallBudget: 60000, categoryBudgets, categories: CATS, resetDay, ref })
      const n = computeBudget({ expenses, income, overallBudget: 60000, categoryBudgets, categories: CATS, resetDay, now: ref })
      const where = `r=${resetDay} ref=${localDayKey(ref)}`
      close(n.spent, o.spent, `${where} spent`)
      close(n.previousSpent, o.prevSpent, `${where} previous`)
      close(n.remaining, o.remaining, `${where} remaining`)
      assert.equal(n.days.left, o.left, `${where} days left`)
      close(n.safeToSpendPerDay, o.safe, `${where} safe/day`, 0.02)
      close(n.percentUsed, o.percent, `${where} percent`, 0.01)
      assert.equal(n.status, o.status, `${where} status`)
      assert.deepEqual(n.categories.map((c) => c.categoryId), o.cats.map((c) => c.id), `${where} category order`)
      n.categories.forEach((c, i) => {
        close(c.spent, o.cats[i].spent, `${where} ${c.categoryId} spent`)
        assert.equal(c.budget, o.cats[i].budget)
        close(c.percentUsed, o.cats[i].percentUsed, `${where} ${c.categoryId} %`, 0.01)
        assert.equal(c.status, o.cats[i].status, `${where} ${c.categoryId} status`)
      })
      if (o.topSpent > 0) assert.equal(n.topCategory.categoryId, o.topId, `${where} top category`)
      close(n.biggestExpense ? n.biggestExpense.amount : 0, o.biggest, `${where} biggest`)
      close(n.dailyAverage, o.dailyAvg, `${where} daily average`, 0.02)
      close(n.cycleIncome, o.income, `${where} income`)
      close(n.netCashflow, o.net, `${where} cashflow`)
      close(n.savingsRate, o.savings, `${where} savings rate`, 0.01)
      close(n.cycleOverCycleChange, o.change, `${where} change vs last cycle`, 0.05)
      assert.deepEqual(n.alerts.map((a) => ({ scope: a.scope, level: a.level })), o.alerts, `${where} alerts`)
      compared++
    }
  }
  assert.ok(compared >= 80, `compared ${compared} cases`)
})

// ---- refunds ----------------------------------------------------------------

test('refunds reduce spent; category rows reconcile to it (including unknown categories)', () => {
  const now = NOW(2026, 11, 15)
  const expenses = [
    tx(noon(2026, 11, 8), 1000, 'food'),
    refund(noon(2026, 11, 9), 300, 'food'),
    refund(noon(2026, 11, 10), 200, 'shop'), // refund-only category
    tx(noon(2026, 11, 11), 50, 'deleted-cat'), // not in CATS
    tx(noon(2026, 10, 20), 999, 'food'), // previous cycle
  ]
  const b = computeBudget({ expenses, categories: CATS, categoryBudgets: { food: 2000, shop: 500 }, overallBudget: 1000, resetDay: 6, now })
  assert.equal(b.gross, 1050)
  assert.equal(b.refunds, 500)
  assert.equal(b.spent, 550)
  assert.equal(b.previousSpent, 999)
  assert.equal(b.remaining, 450)
  const food = b.categories.find((c) => c.categoryId === 'food')
  const shop = b.categories.find((c) => c.categoryId === 'shop')
  assert.equal(food.spent, 700)
  assert.equal(food.percentUsed, 35)
  assert.equal(shop.spent, -200, 'the real (negative) number is reported')
  assert.equal(shop.barPercent, 0, 'but the bar is clamped')
  assert.equal(shop.status, 'good', 'and a negative category is never "over"')
  assert.equal(shop.remaining, 700)
  assert.equal(b.unlistedSpent, 50)
  const rowsC = b.categories.reduce((s, r) => s + cents(r.spent), 0)
  assert.equal(rowsC + cents(b.unlistedSpent), cents(b.spent), 'rows + unlisted == spent')
  assert.equal(b.topCategory.categoryId, 'food')
  assert.deepEqual(b.alerts, [])
})

test('a category with no budget: net <= 0 shows 0%, net > 0 keeps the original 100% / warn', () => {
  const now = NOW(2026, 11, 15)
  const b = computeBudget({ expenses: [tx(noon(2026, 11, 8), 10, 'food'), refund(noon(2026, 11, 8), 40, 'shop')], categories: CATS, resetDay: 6, now })
  const food = b.categories.find((c) => c.categoryId === 'food')
  const shop = b.categories.find((c) => c.categoryId === 'shop')
  assert.deepEqual([food.percentUsed, food.status], [100, 'warn'])
  assert.deepEqual([shop.percentUsed, shop.status, shop.barPercent], [0, 'good', 0])
})

test('refunds larger than all spending in the cycle: negative spent, healthy status, no top category', () => {
  const now = NOW(2026, 11, 15)
  const b = computeBudget({ expenses: [tx(noon(2026, 11, 8), 100), refund(noon(2026, 11, 9), 250)], categories: CATS, overallBudget: 1000, resetDay: 6, now })
  assert.equal(b.spent, -150)
  assert.equal(b.remaining, 1150)
  assert.equal(b.percentUsed, -15)
  assert.equal(b.barPercent, 0)
  assert.equal(b.status, 'good')
  assert.equal(b.topCategory, null)
  assert.deepEqual(b.highestSpendDay, { day: '2026-11-08', total: 100 }, 'the only day with positive net spending')
  assert.ok(b.safeToSpendPerDay > 0)
  const onlyRefund = computeBudget({ expenses: [refund(noon(2026, 11, 9), 250)], categories: CATS, resetDay: 6, now })
  assert.equal(onlyRefund.highestSpendDay, null, 'no day with positive net spending')
})

test('highest spend day is the highest NET day; the biggest expense ignores refunds', () => {
  const now = NOW(2026, 11, 15)
  const big = tx(noon(2026, 11, 7), 500)
  const b = computeBudget({
    expenses: [tx(noon(2026, 11, 8), 400), refund(noon(2026, 11, 8), 350), big, tx(noon(2026, 11, 9), 120), refund(noon(2026, 11, 9), 9999)],
    categories: CATS,
    resetDay: 6,
    now,
  })
  assert.deepEqual(b.highestSpendDay, { day: '2026-11-07', total: 500 })
  assert.equal(b.biggestExpense.id, big.id)
})

test('empty data, no budget set, and zero-division cases are all finite', () => {
  const b = computeBudget({ now: NOW(2026, 11, 15), resetDay: 6, categories: CATS })
  for (const k of ['spent', 'remaining', 'percentUsed', 'safeToSpendPerDay', 'dailyAverage', 'savingsRate', 'cycleOverCycleChange', 'netCashflow', 'unlistedSpent']) {
    assert.ok(Number.isFinite(b[k]), k)
  }
  assert.equal(b.status, 'good')
  assert.equal(b.biggestExpense, null)
  assert.equal(b.cycleOverCycleChange, 0)
  assert.equal(b.categories.length, CATS.length)
})

test('day counts: first day, middle, last day of a cycle (reset day 6)', () => {
  const d = (y, m, dd) => computeBudget({ now: NOW(y, m, dd), resetDay: 6, categories: [] }).days
  // `left` counts today (the last day of a cycle has 1 left), exactly like the original dashboard
  assert.deepEqual(d(2026, 11, 6), { total: 30, elapsed: 1, left: 30 })
  assert.deepEqual(d(2026, 11, 15), { total: 30, elapsed: 10, left: 21 })
  assert.deepEqual(d(2026, 12, 5), { total: 30, elapsed: 30, left: 1 })
  assert.deepEqual(d(2026, 2, 10), { total: 28, elapsed: 5, left: 24 }) // Feb 6 - Mar 5
})

test('cycle length: the new math is the TRUE length; the legacy daysInCycle was one day too long', () => {
  for (const [y, m, dd, r] of [[2026, 11, 15, 6], [2026, 2, 10, 6], [2028, 2, 20, 1], [2026, 12, 31, 15], [2026, 7, 7, 28]]) {
    const now = NOW(y, m, dd)
    const b = computeBudget({ now, resetDay: r, categories: [] })
    assert.equal(b.days.total, cycleDayProgress(b.cycle, localDayKey(now)).total)
    assert.equal(legacyDaysInCycle(getCycle(now, r)), b.days.total + 1, `${y}-${m}-${dd} r=${r}: the legacy count was one too many`)
  }
  assert.equal(computeBudget({ now: NOW(2026, 11, 15), resetDay: 6, categories: [] }).days.total, 30)
})

test('reset days 29-31 work in short months (the old getCycle overflowed here)', () => {
  const b = computeBudget({ now: NOW(2026, 3, 5), resetDay: 31, categories: [], expenses: [tx(noon(2026, 2, 28), 10), tx(noon(2026, 3, 1), 5)] })
  assert.deepEqual(b.cycle, { startKey: '2026-02-28', endKey: '2026-03-30' })
  assert.equal(b.spent, 15)
  assert.deepEqual(b.previousCycle, { startKey: '2026-01-31', endKey: '2026-02-27' })
})

test('statusForPercent / sanitizeResetDay', () => {
  assert.deepEqual([79.9, 80, 100, 100.01].map(statusForPercent), ['good', 'warn', 'warn', 'over'])
  assert.deepEqual([6, '6', 6.9, 0, 32, NaN, undefined, 31].map((v) => sanitizeResetDay(v)), [6, 6, 6, 6, 6, 6, 6, 31])
})

// ---- ONE figure on Dashboard, Budget and Expenses ----------------------------

function mixedDataset() {
  const list = [
    tx(noon(2026, 11, 7), 1200, 'food', { note: 'new form (local noon)' }),
    tx(at(2026, 11, 8, 0, 20), 300, 'travel', { note: 'now-style just after midnight' }),
    tx(at(2026, 11, 9, 23, 40), 450, 'gym', { note: 'now-style just before midnight' }),
    refund(noon(2026, 11, 10), 500, 'food', { note: 'a refund' }),
    tx(noon(2026, 11, 12), 80, 'shop', { source: 'bill', billId: 'b1' }),
    tx(noon(2026, 10, 30), 777, 'food', { note: 'previous cycle' }),
    tx(noon(2026, 12, 9), 123, 'food', { note: 'next cycle' }),
  ]
  if (pickerSafe) list.push(tx(picked('2026-11-11'), 640, 'travel', { note: 'OLD form (UTC midnight)' }))
  return list
}

test('the same cycle shows the SAME net on Dashboard, Budget and Expenses (with a refund and old/new date formats)', () => {
  const expenses = mixedDataset()
  const now = NOW(2026, 11, 15)
  const resetDay = 6
  // Budget + Dashboard both read computeBudget
  const budget = computeBudget({ expenses, categories: CATS, overallBudget: 5000, resetDay, now })
  // The Expenses page default view: All time + Current cycle, summarised
  const page = summarize(filterTransactions(expenses, { period: 'all', cycle: 'current', now, resetDay }), { now })
  assert.equal(budget.spent, page.net, 'Budget/Dashboard spent === Expenses net')
  assert.equal(budget.gross, page.gross)
  assert.equal(budget.refunds, page.refunds)
  assert.equal(budget.count, page.count)

  const expected = 1200 + 300 + 450 + 80 - 500 + (pickerSafe ? 640 : 0)
  assert.equal(budget.spent, expected)

  // the Dashboard donut/category rows, the trend charts and the page all add up to that same figure
  assert.equal(budget.categories.reduce((s, r) => s + cents(r.spent), 0) + cents(budget.unlistedSpent), cents(budget.spent), 'category rows')
  const days = dailySeries(budget.cycleList)
  assert.equal(days.reduce((s, p) => s + cents(p.total), 0), cents(budget.spent), 'daily trend')
  const weeks = weeklySeries(budget.cycleList)
  assert.equal(weeks.reduce((s, p) => s + cents(p.total), 0), cents(budget.spent), 'weekly trend')
  // the same entries bucket onto the local day the user saw
  assert.ok(days.some((p) => p.date === '2026-11-08' && p.total === 300), 'just-after-midnight entry is on the 8th')
  assert.ok(days.some((p) => p.date === '2026-11-09' && p.total === 450), 'just-before-midnight entry is on the 9th')
  assert.ok(days.some((p) => p.date === '2026-11-10' && p.total === -500), 'a refund-only day charts as negative')
  // and months: the November bar is the net of every November entry
  const month = monthlySeries(expenses, { now, months: 3 })
  assert.deepEqual(month.map((p) => p.date), ['2026-09-01', '2026-10-01', '2026-11-01'])
  const novNet = summarize(filterTransactions(expenses, { period: { id: 'custom', start: '2026-11-01', end: '2026-11-30' } })).net
  assert.equal(month[2].total, novNet)
})

test('Expenses "current cycle" equals Budget for every reset day 1-31 on a random dataset with refunds', () => {
  const rand = mulberry32(5)
  const expenses = []
  for (let i = 0; i < 300; i++) {
    const amount = Math.round(rand() * 300000) / 100 + 1
    const date = new Date(2026, 5, 1 + Math.floor(rand() * 200), Math.floor(rand() * 24)).toISOString()
    expenses.push(rand() < 0.15 ? refund(date, amount / 4, CATS[Math.floor(rand() * 4)].id) : tx(date, amount, CATS[Math.floor(rand() * 4)].id))
  }
  for (let resetDay = 1; resetDay <= 31; resetDay++) {
    for (const now of [NOW(2026, 7, 3), NOW(2026, 8, 31), NOW(2026, 9, 30), NOW(2026, 10, 15)]) {
      const budget = computeBudget({ expenses, categories: CATS, resetDay, now })
      const page = summarize(filterTransactions(expenses, { cycle: 'current', now, resetDay }), { now })
      assert.equal(budget.spent, page.net, `r=${resetDay} ${localDayKey(now)}`)
      assert.equal(budget.categories.reduce((s, r) => s + cents(r.spent), 0) + cents(budget.unlistedSpent), cents(budget.spent))
    }
  }
})

// ---- chart series + helpers --------------------------------------------------

test('dailySeries: net per LOCAL day, oldest first, refunds subtract, unreadable dates skipped', () => {
  const s = dailySeries([tx(at(2026, 11, 2, 0, 5), 10), tx(at(2026, 11, 1, 23, 55), 5), refund(at(2026, 11, 2, 18), 4), tx('nope', 99), tx(at(2026, 11, 2, 12), 1.1)])
  assert.deepEqual(s, [{ date: '2026-11-01', total: 5 }, { date: '2026-11-02', total: 7.1 }])
  assert.deepEqual(dailySeries([]), [])
  assert.deepEqual(dailySeries(null), [])
})

test('weekStartOf / weeklySeries: Monday weeks, across a year boundary, Sunday override', () => {
  assert.equal(weekStartOf('2026-11-15'), '2026-11-09') // a Sunday belongs to the week that began Monday the 9th
  assert.equal(weekStartOf('2026-11-16'), '2026-11-16')
  assert.equal(weekStartOf('2026-01-01'), '2025-12-29')
  assert.equal(weekStartOf('2026-11-15', 0), '2026-11-15')
  const s = weeklySeries([tx(noon(2025, 12, 31), 1), tx(noon(2026, 1, 2), 2), tx(noon(2026, 1, 5), 4), refund(noon(2026, 1, 6), 1)])
  assert.deepEqual(s, [{ date: '2025-12-29', total: 3 }, { date: '2026-01-05', total: 3 }])
  assert.deepEqual(weeklySeries([tx(noon(2026, 11, 15), 1)], { weekStartsOn: 0 }), [{ date: '2026-11-15', total: 1 }])
})

test('monthlySeries: contiguous months including empty ones, year rollover, refunds net', () => {
  const list = [tx(noon(2026, 11, 3), 100), refund(noon(2026, 11, 4), 30), tx(noon(2026, 9, 1), 50), tx(noon(2025, 12, 31), 7)]
  assert.deepEqual(monthlySeries(list, { now: NOW(2026, 11, 15), months: 4 }), [
    { date: '2026-08-01', total: 0 },
    { date: '2026-09-01', total: 50 },
    { date: '2026-10-01', total: 0 },
    { date: '2026-11-01', total: 70 },
  ])
  assert.deepEqual(monthlySeries(list, { now: NOW(2026, 1, 20), months: 3 }).map((p) => p.date), ['2025-11-01', '2025-12-01', '2026-01-01'])
  assert.equal(monthlySeries(list, { now: NOW(2026, 1, 20), months: 3 })[1].total, 7)
  assert.equal(monthlySeries([], { now: NOW(2026, 11, 15) }).length, 6)
})

test('dayInRange and formatDayKey({year:false})', () => {
  const range = { startKey: '2026-11-06', endKey: '2026-12-05' }
  assert.equal(dayInRange(at(2026, 11, 6, 0, 1), range), true)
  assert.equal(dayInRange(at(2026, 12, 5, 23, 59), range), true)
  assert.equal(dayInRange(at(2026, 12, 6, 0, 1), range), false)
  assert.equal(dayInRange(at(2026, 11, 5, 23, 59), range), false)
  assert.equal(dayInRange('nope', range), false)
  assert.equal(formatDayKey('2026-11-06', { year: false }), '6 Nov')
  assert.equal(formatDayKey('2026-11-06', { year: false, weekday: true }), 'Fri 6 Nov')
})

test('budgetMath.js stays pure: only imports reporting.js, no browser globals, no setMonth', () => {
  const source = readFileSync(fileURLToPath(new URL('../app/utils/budgetMath.js', import.meta.url)), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  const imports = [...code.matchAll(/^\s*import[^\n]*from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imports, ['./reporting.js'])
  assert.doesNotMatch(code, /localStorage|document|window|setMonth\(/)
  assert.doesNotMatch(code, /\.date\b[^\n;]*\.slice\(/)
})
