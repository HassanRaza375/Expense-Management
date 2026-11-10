// Phase 5: insights (src/utils/insights.js): fixed, explainable rules; quiet when there is little data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { buildInsights } from '../src/utils/insights.js'
import { computeBudget } from '../src/utils/budgetMath.js'

const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
const NOW = new Date(2026, 10, 20, 12) // 20 Nov 2026; with reset day 1 the cycle is 1-30 Nov, day 20 of 30
let seq = 0
const tx = (date, amount, extra = {}) => ({ id: `t${++seq}`, date, amount, categoryId: 'food', note: '', createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...extra })
const inc = (date, amount) => ({ id: `i${++seq}`, date, amount, sourceType: 'salary', createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString() })
const money = (n) => `Rs ${n}`
const run = (inputs, opts = {}) => buildInsights({ resetDay: 1, ...inputs }, { now: NOW, format: money, ...opts })
const ids = (list) => list.map((i) => i.id)

test('no data: no insights (it never says something vague)', () => {
  assert.deepEqual(run({}), [])
  assert.deepEqual(run({ expenses: [], income: [], overallBudget: 1000 }), [])
})

test('budget pace: ahead of the calendar warns, over budget is flagged, well under pace is a quiet good note', () => {
  // day 20 of 30 = 66.7% of the cycle
  const ahead = run({ expenses: [tx(noon(2026, 11, 10), 900)], overallBudget: 1000 }) // 90% used
  assert.equal(ahead[0].id, 'budget-pace')
  assert.equal(ahead[0].level, 'warn')
  assert.match(ahead[0].detail, /90% of your budget is used but only 67% of the cycle has passed/)
  assert.equal(ahead[0].to, '/budget')

  const over = run({ expenses: [tx(noon(2026, 11, 10), 1200)], overallBudget: 1000 })
  assert.equal(over[0].id, 'budget-over')
  assert.equal(over[0].level, 'over')

  const under = run({ expenses: [tx(noon(2026, 11, 10), 100)], overallBudget: 1000 })
  assert.equal(under[0].id, 'budget-under')
  assert.equal(under[0].level, 'good')

  assert.deepEqual(run({ expenses: [tx(noon(2026, 11, 10), 650)], overallBudget: 1000 }), [], 'on pace: nothing to say')
  assert.deepEqual(run({ expenses: [tx(noon(2026, 11, 10), 900)], overallBudget: 0 }), [], 'no budget set: no pace talk')
})

test('budget pace uses the same figures as the budget (refunds taken off) and does not warn in the first days of a cycle', () => {
  // gross 1300 would be "over budget"; with the 400 refund taken off it is 900 = 90% used: a pace warning, not "over"
  const refunded = run({ expenses: [tx(noon(2026, 11, 10), 1300), tx(noon(2026, 11, 11), 400, { kind: 'refund' })], overallBudget: 1000 })
  assert.equal(refunded[0].id, 'budget-pace')
  assert.match(refunded[0].detail, /90% of your budget is used/)
  const b = computeBudget({ expenses: [tx(noon(2026, 11, 10), 1300), tx(noon(2026, 11, 11), 400, { kind: 'refund' })], overallBudget: 1000, resetDay: 1, now: NOW })
  assert.equal(b.spent, 900)
  const early = buildInsights({ resetDay: 1, expenses: [tx(noon(2026, 11, 2), 900)], overallBudget: 1000 }, { now: new Date(2026, 10, 3, 12), format: money })
  assert.deepEqual(early, [], 'day 3 of 30: too early to call it a pace')
})

test('category spike: needs history; compares with the average of earlier cycles; ignores small categories', () => {
  const history = [tx(noon(2026, 8, 10), 500, { categoryId: 'fun' }), tx(noon(2026, 9, 10), 500, { categoryId: 'fun' }), tx(noon(2026, 10, 10), 500, { categoryId: 'fun' }), tx(noon(2026, 10, 12), 1000, { categoryId: 'food' }), tx(noon(2026, 9, 12), 1000, { categoryId: 'food' }), tx(noon(2026, 8, 12), 1000, { categoryId: 'food' })]
  const spike = run({ expenses: [...history, tx(noon(2026, 11, 5), 1500, { categoryId: 'fun' }), tx(noon(2026, 11, 6), 1000, { categoryId: 'food' })], categoryNames: { fun: 'Entertainment', food: 'Food' } })
  const s = spike.find((i) => i.id === 'spike-fun')
  assert.ok(s, ids(spike).join())
  assert.equal(s.title, 'Entertainment is higher than usual')
  assert.match(s.detail, /Rs 1500 this cycle against an average of Rs 500 over your last 3 cycles/)
  assert.ok(!spike.some((i) => i.id === 'spike-food'), 'food was flat')
  // one earlier cycle is not enough history
  assert.ok(!run({ expenses: [tx(noon(2026, 10, 10), 500, { categoryId: 'fun' }), tx(noon(2026, 11, 5), 1500, { categoryId: 'fun' })] }).some((i) => i.id.startsWith('spike-')))
  // a tiny category doubling is noise
  const tiny = run({ expenses: [tx(noon(2026, 9, 10), 10, { categoryId: 'tea' }), tx(noon(2026, 10, 10), 10, { categoryId: 'tea' }), tx(noon(2026, 11, 5), 30, { categoryId: 'tea' }), tx(noon(2026, 11, 6), 5000, { categoryId: 'rent' })] })
  assert.ok(!tiny.some((i) => i.id === 'spike-tea'))
})

test('savings rate: compares the last two COMPLETE cycles, never the unfinished current one', () => {
  const income = [inc(noon(2026, 9, 2), 1000), inc(noon(2026, 10, 2), 1000), inc(noon(2026, 11, 2), 1000)]
  const down = run({ income, expenses: [tx(noon(2026, 9, 5), 200), tx(noon(2026, 10, 5), 700), tx(noon(2026, 11, 5), 999)] })
  const s = down.find((i) => i.id === 'savings-down')
  assert.ok(s)
  assert.match(s.detail, /kept 30% of your income, down from 80%/)
  const up = run({ income, expenses: [tx(noon(2026, 9, 5), 800), tx(noon(2026, 10, 5), 300)] })
  assert.ok(up.some((i) => i.id === 'savings-up'))
  const flat = run({ income, expenses: [tx(noon(2026, 9, 5), 500), tx(noon(2026, 10, 5), 520)] })
  assert.ok(!flat.some((i) => i.id.startsWith('savings-')))
  assert.ok(!run({ income: [inc(noon(2026, 10, 2), 1000)], expenses: [tx(noon(2026, 10, 5), 900)] }).some((i) => i.id.startsWith('savings-')), 'no income the cycle before: no comparison')
})

test('bills: overdue is flagged, due within 7 days is informational, paid/cancelled/far-off are ignored', () => {
  const bill = (day, extra = {}) => ({ dueDate: noon(2026, 11, day), status: 'unpaid', amount: 1000, arrears: 0, ...extra })
  const overdue = run({ bills: [bill(10), bill(22), bill(15, { status: 'paid' })] })
  assert.equal(overdue[0].id, 'bills-overdue')
  assert.equal(overdue[0].level, 'over')
  assert.match(overdue[0].detail, /Rs 1000 unpaid and past the due date, and Rs 1000 more due this week/)
  assert.match(run({ bills: [bill(10)] })[0].detail, /^Rs 1000 unpaid and past the due date.$/, 'nothing else due: no trailing clause')
  const soon = run({ bills: [bill(22), bill(26), bill(28, { status: 'cancelled' })] })
  assert.equal(soon[0].id, 'bills-due')
  assert.equal(soon[0].title, 'A bill is due this week'.replace('A bill is', '2 bills are'))
  assert.deepEqual(run({ bills: [bill(29), bill(25, { status: 'paid' })] }), [])
  assert.doesNotThrow(() => run({ bills: [null, {}, { dueDate: 'nope', status: 'unpaid' }] }))
})

test('looks recurring: the same note and amount in 3+ months, unless it is already recurring, a bill or a refund', () => {
  const netflix = [tx(noon(2026, 8, 3), 1200, { note: 'Netflix' }), tx(noon(2026, 9, 3), 1200, { note: ' netflix ' }), tx(noon(2026, 10, 3), 1200, { note: 'NETFLIX' })]
  const r = run({ expenses: netflix })
  assert.equal(r[0].id, 'recurring-netflix')
  assert.match(r[0].detail, /Rs 1200 in 3 different months/)
  assert.equal(r[0].to, '/recurring')
  assert.deepEqual(run({ expenses: netflix, recurring: [{ name: 'Netflix' }] }), [], 'a template with that name exists')
  assert.deepEqual(run({ expenses: [tx(noon(2026, 8, 3), 1200, { note: 'Netflix' }), tx(noon(2026, 9, 3), 1250, { note: 'Netflix' }), tx(noon(2026, 10, 3), 1200, { note: 'Netflix' })] }), [], 'amounts differ')
  assert.deepEqual(run({ expenses: [tx(noon(2026, 8, 3), 1200, { note: 'Netflix' }), tx(noon(2026, 8, 20), 1200, { note: 'Netflix' }), tx(noon(2026, 9, 3), 1200, { note: 'Netflix' })] }), [], 'two months only')
  assert.deepEqual(run({ expenses: netflix.map((e) => ({ ...e, source: 'bill' })) }), [])
  assert.deepEqual(run({ expenses: netflix.map((e) => ({ ...e, kind: 'refund' })) }), [])
  assert.deepEqual(run({ expenses: [tx(noon(2026, 8, 3), 5, { note: 'ab' }), tx(noon(2026, 9, 3), 5, { note: 'ab' }), tx(noon(2026, 10, 3), 5, { note: 'ab' })] }), [], 'a 2-letter note is too vague')
})

test('goals behind schedule or past their date are surfaced', () => {
  const r = run({ goals: [{ name: 'Holiday', status: 'behind' }, { name: 'Car', status: 'overdue' }, { name: 'Fine', status: 'on-track' }, { name: 'Done', status: 'reached' }] })
  assert.deepEqual(ids(r).sort(), ['goal-Car', 'goal-Holiday'])
  assert.ok(r.every((i) => i.to === '/goals'))
})

test('ordering and limit: most urgent first, never more than the limit', () => {
  const inputs = {
    expenses: [tx(noon(2026, 11, 10), 1200)],
    overallBudget: 1000,
    bills: [{ dueDate: noon(2026, 11, 22), status: 'unpaid', amount: 5, arrears: 0 }],
    goals: [{ name: 'Holiday', status: 'behind' }],
  }
  const all = run(inputs, { limit: 10 })
  assert.deepEqual(all.map((i) => i.level), ['over', 'warn', 'info'])
  assert.equal(run(inputs, { limit: 1 }).length, 1)
  assert.equal(run(inputs, { limit: 0 }).length, 0)
})

test('insights are deterministic and do not mutate their input', () => {
  const expenses = [tx(noon(2026, 11, 10), 900), tx(noon(2026, 10, 10), 100)]
  const before = JSON.stringify(expenses)
  const a = run({ expenses, overallBudget: 1000 })
  const b = run({ expenses, overallBudget: 1000 })
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(expenses), before)
})

test('every insight has an id, a level, a title, a reason (detail) and a place to go', () => {
  const inputs = { expenses: [tx(noon(2026, 11, 10), 1200)], overallBudget: 1000, bills: [{ dueDate: noon(2026, 11, 1), status: 'unpaid', amount: 5 }], goals: [{ name: 'G', status: 'behind' }] }
  for (const i of run(inputs, { limit: 10 })) {
    assert.ok(i.id && ['warn', 'over', 'info', 'good'].includes(i.level) && i.title && i.detail && i.to.startsWith('/'), JSON.stringify(i))
  }
})

test('the module is pure: no Vue, no storage', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/utils/insights.js', import.meta.url)), 'utf8')
  assert.doesNotMatch(src, /from 'vue'|storage\.js|localStorage|composables\//)
})
