// Tests for the composables touched in Phase 1.3: useBills (bill <-> expense link), useBudget (thin wrapper over the
// pure budget math) and a source guard that Settings and the Expenses page share ONE CSV exporter.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const store = new Map()
globalThis.localStorage = {
  get length() {
    return store.size
  },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
}

const { useExpenses } = await import('../src/composables/useExpenses.js')
const { useBills, useConnections } = await import('../src/composables/useBills.js')
const { useBudget } = await import('../src/composables/useBudget.js')
const { useIncome } = await import('../src/composables/useIncome.js')
const { useSettings } = await import('../src/composables/useSettings.js')
const { localNoonISO, filterTransactions, summarize, localDayKey } = await import('../src/utils/reporting.js')

const ex = useExpenses()
const billsApi = useBills()
const conns = useConnections()
const noon = (y, m, d) => localNoonISO(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

const conn = conns.addConnection({ connectionName: 'Home internet', billType: 'internet' })
let month = 0

function newBill(amount = 1500) {
  month++
  return billsApi.addBill({ connectionId: conn.id, billingMonth: `2026-${String(month).padStart(2, '0')}`, dueDate: '2026-11-20', amount, arrears: 0 })
}
const payment = { paidDate: noon(2026, 11, 7), paidBy: 'me', paymentMethod: 'cash', transactionReference: 'REF1', categoryId: 'cat-bills' }

beforeEach(() => {
  ex.expenses.splice(0, ex.expenses.length)
  billsApi.bills.splice(0, billsApi.bills.length)
  month = 0
})

// ---- bill <-> expense link ----------------------------------------------------

test('markPaid creates ONE linked expense on the paid date (local noon) and marks the bill paid', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  assert.equal(ex.expenses.length, 1)
  const e = ex.expenses[0]
  assert.equal(e.amount, 1500)
  assert.equal(e.source, 'bill')
  assert.equal(e.billId, bill.id)
  assert.equal(e.date, payment.paidDate)
  assert.equal(localDayKey(e.date), '2026-11-07')
  const b = billsApi.findBill(bill.id)
  assert.equal(b.status, 'paid')
  assert.equal(b.linkedExpenseId, e.id)
})

test('paying again while the expense still exists UPDATES it (no duplicate)', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  billsApi.updateBill(bill.id, { status: 'unpaid' }) // what the bill wizard allows
  billsApi.markPaid(bill.id, { ...payment, categoryId: 'cat-bills' })
  assert.equal(ex.expenses.length, 1)
})

test('markPaid RE-CREATES the expense when the linked one was deleted (it used to silently skip it)', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  const oldId = ex.expenses[0].id
  ex.deleteExpense(oldId) // deleted without going through unlinkExpenses, e.g. old data or another code path
  billsApi.updateBill(bill.id, { status: 'unpaid' })
  billsApi.markPaid(bill.id, payment)
  assert.equal(ex.expenses.length, 1, 'the payment counts as spending again')
  assert.notEqual(ex.expenses[0].id, oldId)
  assert.equal(billsApi.findBill(bill.id).linkedExpenseId, ex.expenses[0].id)
})

test('deleting a bill-payment expense (unlinkExpenses) sends the bill back to UNPAID and clears the payment details', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  const other = newBill(700)
  const exp = ex.expenses[0]
  assert.equal(billsApi.linkedBillFor(exp.id).id, bill.id)

  const changes = billsApi.unlinkExpenses([exp.id])
  ex.deleteExpense(exp.id)

  const b = billsApi.findBill(bill.id)
  assert.equal(b.status, 'unpaid')
  assert.equal(b.linkedExpenseId, null)
  assert.equal(b.paidDate, null)
  assert.equal(b.paidBy, '')
  assert.equal(b.paymentMethod, null)
  assert.equal(b.transactionReference, '')
  assert.equal(billsApi.findBill(other.id).status, 'unpaid', 'other bills are untouched')
  assert.equal(billsApi.effectiveStatus(b), 'unpaid')
  assert.equal(billsApi.unpaidCount() >= 1, true)

  // and it can be paid (and counted) again
  billsApi.markPaid(bill.id, payment)
  assert.equal(ex.expenses.length, 1)
  assert.equal(billsApi.findBill(bill.id).status, 'paid')
  assert.equal(changes.length, 1)
})

test('Undo of that delete (restoreLinks) puts the bill back exactly as it was', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  const before = JSON.parse(JSON.stringify(billsApi.findBill(bill.id)))
  const exp = ex.expenses[0]

  const changes = billsApi.unlinkExpenses([exp.id])
  const removed = ex.deleteMany([exp.id])
  ex.restoreMany(removed)
  billsApi.restoreLinks(changes)

  assert.deepEqual(JSON.parse(JSON.stringify(billsApi.findBill(bill.id))), before)
  assert.equal(billsApi.linkedBillFor(exp.id).id, bill.id)
})

test('unlinkExpenses ignores expenses that are not bill payments, and handles several at once', () => {
  const b1 = newBill(100)
  const b2 = newBill(200)
  billsApi.markPaid(b1.id, payment)
  billsApi.markPaid(b2.id, payment)
  const plain = ex.addExpense({ date: noon(2026, 11, 8), amount: 5, categoryId: 'cat-food' })
  const ids = ex.expenses.map((e) => e.id)
  const changes = billsApi.unlinkExpenses(ids)
  assert.equal(changes.length, 2)
  assert.equal(billsApi.linkedBillFor(plain.id), null)
  assert.deepEqual([b1, b2].map((b) => billsApi.findBill(b.id).status), ['unpaid', 'unpaid'])
  assert.deepEqual(billsApi.unlinkExpenses([]), [])
  assert.deepEqual(billsApi.unlinkExpenses(undefined), [])
})

test('a bill the user already set back to unpaid keeps its other fields when only the link is cleared', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  billsApi.updateBill(bill.id, { status: 'awaiting' })
  billsApi.unlinkExpenses([ex.expenses[0].id])
  const b = billsApi.findBill(bill.id)
  assert.equal(b.status, 'awaiting', 'only a PAID bill is flipped to unpaid')
  assert.equal(b.linkedExpenseId, null)
})

test('deleteBill KEEPS its expense (the money was spent) and clears the expense\'s billId', () => {
  const bill = newBill(1500)
  billsApi.markPaid(bill.id, payment)
  const unrelated = ex.addExpense({ date: noon(2026, 11, 8), amount: 5, categoryId: 'cat-food' })
  const exp = ex.expenses.find((e) => e.billId === bill.id)
  billsApi.deleteBill(bill.id)
  assert.equal(billsApi.findBill(bill.id), undefined)
  assert.equal(ex.expenses.length, 2, 'both expenses remain')
  const kept = ex.findById(exp.id)
  assert.equal(kept.billId, null)
  assert.equal(kept.amount, 1500)
  assert.equal(kept.source, 'bill', 'it is still labelled as a bill payment')
  assert.equal(ex.findById(unrelated.id).billId, null)
})

test('clearBillLinks only touches expenses of that bill', () => {
  const a = ex.addExpense({ date: noon(2026, 11, 8), amount: 5, categoryId: 'cat-food', billId: 'A' })
  const b = ex.addExpense({ date: noon(2026, 11, 8), amount: 6, categoryId: 'cat-food', billId: 'B' })
  assert.deepEqual(ex.clearBillLinks('A'), [a.id])
  assert.equal(a.billId, null)
  assert.equal(b.billId, 'B')
})

// ---- useBudget is a thin wrapper: its numbers ARE the pure ones ---------------

test('useBudget (Dashboard + Budget) and the Expenses page agree on net spent, with a refund and old/new dates', () => {
  const { settings } = useSettings()
  settings.cycleResetDay = 6
  settings.overallBudget = 10000
  settings.categoryBudgets = { 'cat-food': 2000 }
  const income = useIncome()
  income.income.splice(0, income.income.length)
  income.addIncome({ date: noon(2026, 11, 7), amount: 5000, sourceType: 'salary' })

  const now = new Date(2026, 10, 15, 12)
  ex.addExpense({ date: noon(2026, 11, 7), amount: 1200, categoryId: 'cat-food' })
  ex.addExpense({ date: new Date(2026, 10, 8, 0, 20).toISOString(), amount: 300, categoryId: 'cat-travel' }) // now-style, just after midnight
  ex.addExpense({ date: noon(2026, 11, 10), amount: 500, categoryId: 'cat-food', kind: 'refund' })
  ex.addExpense({ date: noon(2026, 10, 30), amount: 777, categoryId: 'cat-food' }) // previous cycle
  if (new Date('2026-11-11').getTimezoneOffset() <= 0) ex.addExpense({ date: new Date('2026-11-11').toISOString(), amount: 40, categoryId: 'cat-gym' }) // old picker format

  const budget = useBudget(now)
  const page = summarize(filterTransactions(ex.expenses, { period: 'all', cycle: 'current', now, resetDay: 6 }), { now })

  assert.equal(budget.cycleSpent.value, page.net, 'Dashboard "Spent this cycle" / Budget "This cycle" === Expenses net')
  assert.equal(budget.cycleGross.value, page.gross)
  assert.equal(budget.cycleRefunds.value, page.refunds)
  assert.equal(budget.cycleRefunds.value, 500)
  assert.equal(budget.previousCycleSpent.value, 777)
  assert.equal(budget.cycleExpenses.value.length, page.count)

  const rowsC = budget.categoryBreakdown.value.reduce((s, r) => s + Math.round(r.spent * 100), 0)
  assert.equal(rowsC + Math.round(budget.unlistedSpent.value * 100), Math.round(budget.cycleSpent.value * 100))
  const food = budget.categoryBreakdown.value.find((r) => r.category.id === 'cat-food')
  assert.equal(food.spent, 700)
  assert.equal(food.percentUsed, 35)

  assert.equal(budget.overallRemaining.value, 10000 - page.net)
  assert.equal(budget.cycleIncome.value, 5000)
  assert.equal(budget.netCashflow.value, 5000 - page.net)
  assert.equal(budget.daysLeftInCycle.value, 21)
  assert.equal(budget.topCategory.value.category.id, 'cat-food', 'food is 700 net, travel 300')
  assert.equal(budget.topCategory.value.spent, 700)
  assert.ok(budget.inCycle(noon(2026, 11, 20)))
  assert.ok(!budget.inCycle(noon(2026, 12, 6)))

  // Date-based cycle for CycleRail / recurring: local midnight start (same as the old getCycle)
  assert.equal(budget.cycle.value.start.getTime(), new Date(2026, 10, 6, 0, 0, 0, 0).getTime())
  assert.equal(budget.cycle.value.end.getTime(), new Date(2026, 11, 5, 23, 59, 59, 999).getTime())
})

// ---- one exporter -------------------------------------------------------------

test('Settings and the Expenses page share ONE CSV exporter (no second copy of the format)', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  const settings = read('../src/views/SettingsView.vue')
  const expensesView = read('../src/views/ExpensesView.vue')
  assert.match(settings, /downloadTransactionsCsv\(/)
  assert.match(expensesView, /downloadTransactionsCsv\(/)
  for (const src of [settings, expensesView]) {
    assert.doesNotMatch(src, /date,amount,category/, 'no hand-written CSV header')
    assert.doesNotMatch(src, /type: 'text\/csv/, 'no own CSV Blob')
    assert.doesNotMatch(src, /transactionsToCsv\(/, 'only the shared exporter builds CSV')
  }
  const exporter = read('../src/utils/csvExport.js')
  assert.match(exporter, /transactionsToCsv\(/)
})

test('no page still uses the old UTC-slice grouping or the overflowing getAdjacentCycle for the Dashboard/Budget', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  for (const f of ['../src/views/DashboardView.vue', '../src/views/BudgetView.vue', '../src/composables/useBudget.js', '../src/composables/useExpenses.js']) {
    const src = read(f)
    assert.doesNotMatch(src, /getAdjacentCycle|groupedByWeek|groupedByMonth|groupedByDay|\.slice\(0, 10\)/, f)
  }
})
