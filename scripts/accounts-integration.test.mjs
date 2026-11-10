// Phase 2.5: bills, recurring templates and loans/repayments carry an optional account; lending moves balances but is
// never spending or income; an account used by a loan cannot be deleted.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './fake-indexeddb.mjs'

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
installFakeIndexedDB()

const { useAccounts } = await import('../src/composables/useAccounts.js')
const { useExpenses } = await import('../src/composables/useExpenses.js')
const { useBills, useConnections } = await import('../src/composables/useBills.js')
const { useRecurring } = await import('../src/composables/useRecurring.js')
const { useLending } = await import('../src/composables/useLending.js')
const { localNoonISO, summarize } = await import('../src/utils/reporting.js')
const { accountForNewRecord } = await import('../src/utils/accountsView.js')

const acc = useAccounts()
const ex = useExpenses()
const billsApi = useBills()
const rec = useRecurring()
const lend = useLending()
const conn = useConnections().addConnection({ connectionName: 'Home', billType: 'electricity' })
const today = new Date()
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const open = (name, extra = {}) => acc.addAccount({ name, type: 'bank', openingBalance: 1000, openingDate: '2000-01-01', ...extra })
let month = 0
const newBill = () => billsApi.addBill({ connectionId: conn.id, billingMonth: `2026-${String(++month).padStart(2, '0')}`, dueDate: '2026-12-20', amount: 2000, currentReading: 100 + month })
const payArgs = { paidDate: localNoonISO('2026-11-07'), paidBy: 'me', paymentMethod: 'cash', transactionReference: '', categoryId: 'cat-bills' }

beforeEach(() => {
  acc.accounts.splice(0, acc.accounts.length)
  acc.transfers.splice(0, acc.transfers.length)
  acc.adjustments.splice(0, acc.adjustments.length)
  ex.expenses.splice(0, ex.expenses.length)
  billsApi.bills.splice(0, billsApi.bills.length)
  rec.recurring.splice(0, rec.recurring.length)
  lend.loans.splice(0, lend.loans.length)
})

// ---- bills ------------------------------------------------------------------------------------------------------------

test('markPaid carries the account onto the payment expense; without an account the expense is exactly as before', () => {
  const a = open('Bank')
  const b1 = newBill()
  billsApi.markPaid(b1.id, { ...payArgs, accountId: a.id })
  const paid = ex.findById(billsApi.findBill(b1.id).linkedExpenseId)
  assert.equal(paid.accountId, a.id)
  assert.equal(acc.balanceOf(a.id).balance, 1000 - 2000, 'the bill payment leaves the account (and the account may go negative)')

  const b2 = newBill()
  billsApi.markPaid(b2.id, payArgs) // old call shape: no accountId at all
  const plain = ex.findById(billsApi.findBill(b2.id).linkedExpenseId)
  assert.equal('accountId' in plain, false, 'no accountId key is stored when none was given')
})

test('paying again: accountId undefined leaves the account alone, an id moves it, "" clears it', () => {
  const a = open('A')
  const b = open('B')
  const bill = newBill()
  billsApi.markPaid(bill.id, { ...payArgs, accountId: a.id })
  const id = billsApi.findBill(bill.id).linkedExpenseId
  billsApi.markPaid(bill.id, payArgs)
  assert.equal(ex.findById(id).accountId, a.id, 'undefined = untouched')
  billsApi.markPaid(bill.id, { ...payArgs, accountId: b.id })
  assert.equal(ex.findById(id).accountId, b.id)
  billsApi.markPaid(bill.id, { ...payArgs, accountId: '' })
  assert.equal('accountId' in ex.findById(id), false)
})

test('a bill payment moves the account but never changes the spending total', () => {
  const a = open('Bank')
  const bill = newBill()
  const before = summarize(ex.expenses).net
  billsApi.markPaid(bill.id, { ...payArgs, accountId: a.id })
  assert.equal(summarize(ex.expenses).net - before, 2000)
  billsApi.markPaid(bill.id, { ...payArgs, accountId: '' }) // un-assigning changes balances only
  assert.equal(summarize(ex.expenses).net - before, 2000)
})

// ---- recurring ----------------------------------------------------------------------------------------------------------

test('recurring templates: accountId is optional, stored only when given, can be changed and cleared', () => {
  const a = open('A')
  const plain = rec.addTemplate({ name: 'Gym', categoryId: 'cat-health', amountMode: 'fixed', amount: 1000, dueDay: 5 })
  assert.equal('accountId' in plain, false)
  const withAcc = rec.addTemplate({ name: 'Rent', categoryId: 'cat-home', amountMode: 'fixed', amount: 5000, dueDay: 1, accountId: a.id })
  assert.equal(withAcc.accountId, a.id)
  rec.updateTemplate(withAcc.id, { name: 'Rent!', accountId: '' })
  assert.equal('accountId' in rec.findById(withAcc.id), false)
  assert.equal(rec.findById(withAcc.id).name, 'Rent!')
  rec.updateTemplate(plain.id, { name: 'Gym2' }) // a patch without accountId leaves it alone
  assert.equal(rec.findById(plain.id).name, 'Gym2')
})

test('accountForNewRecord: the template account if usable, else the default if usable, else none', () => {
  const a = open('A')
  const b = open('B')
  acc.archiveAccount(b.id)
  const s = acc.store
  assert.equal(accountForNewRecord(s, { preferredId: a.id, defaultAccountId: '' }), a.id)
  assert.equal(accountForNewRecord(s, { preferredId: b.id, defaultAccountId: a.id }), a.id, 'archived template account falls back to the default')
  assert.equal(accountForNewRecord(s, { preferredId: 'gone', defaultAccountId: 'also-gone' }), '')
  assert.equal(accountForNewRecord(s, {}), '')
  assert.equal(accountForNewRecord({ accounts: [] }, { preferredId: a.id }), '')
})

// ---- lending ------------------------------------------------------------------------------------------------------------

test('loans and repayments: accountId is optional; stored only when given; editable and clearable', () => {
  const a = open('A')
  const plain = lend.addLoan({ direction: 'lent', personName: 'Ali', amount: 500 })
  assert.equal('accountId' in plain, false)
  const l = lend.addLoan({ direction: 'lent', personName: 'Sara', amount: 800, accountId: a.id })
  assert.equal(l.accountId, a.id)
  lend.addRepayment(l.id, { amount: 100, accountId: a.id })
  lend.addRepayment(l.id, { amount: 50 })
  const reps = lend.findById(l.id).repayments
  assert.equal(reps[0].accountId, a.id)
  assert.equal('accountId' in reps[1], false)
  lend.updateLoan(l.id, { accountId: '' })
  assert.equal('accountId' in lend.findById(l.id), false)
})

test('lending moves the account balance through the store (lent = out, repayment = in) and is not spending', () => {
  const a = open('Bank')
  const loan = lend.addLoan({ direction: 'lent', personName: 'Ali', amount: 300, accountId: a.id, date: localNoonISO(todayKey) })
  assert.equal(acc.balanceOf(a.id).balance, 1000 - 300)
  lend.addRepayment(loan.id, { amount: 100, accountId: a.id, date: localNoonISO(todayKey) })
  assert.equal(acc.balanceOf(a.id).balance, 1000 - 300 + 100)
  const ledgerTypes = acc.ledger(a.id).map((r) => r.type)
  assert.deepEqual(ledgerTypes, ['opening', 'loan-out', 'repayment-in'])
  assert.equal(summarize(ex.expenses).net, 0, 'no expense was created')
  assert.equal(acc.overview().total, 800)
})

test('an account used by a loan or a repayment cannot be deleted (archive it instead)', () => {
  const a = open('A')
  const b = open('B')
  const loan = lend.addLoan({ direction: 'lent', personName: 'Ali', amount: 300, accountId: a.id })
  lend.addRepayment(loan.id, { amount: 10, accountId: b.id })
  assert.equal(acc.referenceCount(a.id), 1)
  assert.equal(acc.referenceCount(b.id), 1, 'a repayment alone is enough to keep the account')
  assert.throws(() => acc.deleteAccount(a.id), /Archive it instead/)
  assert.throws(() => acc.deleteAccount(b.id), /Archive it instead/)
  acc.archiveAccount(a.id)
  assert.equal(acc.balanceOf(a.id).balance, 700, 'archiving keeps the history and the balance')
})
