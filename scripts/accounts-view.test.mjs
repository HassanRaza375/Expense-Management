// Phase 2.3: the view model behind the Accounts screens (src/utils/accountsView.js) and the guarantee that nothing the
// screens do (accounts, transfers, corrections) changes a spending figure on the Dashboard, Budget, Expenses or CSV.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
const { useIncome } = await import('../src/composables/useIncome.js')
const { useSettings } = await import('../src/composables/useSettings.js')
const { useBudget } = await import('../src/composables/useBudget.js')
const { accountCards, unassignedSummary, describeRow, ledgerView, limitGroups, transferChoices, defaultTransferPair, reconcileView } = await import('../src/utils/accountsView.js')
const { accountBalance } = await import('../src/utils/accounts.js')
const { summarize, filterTransactions, transactionsToCsv, localDayKey } = await import('../src/utils/reporting.js')

const acc = useAccounts()
const ex = useExpenses()
const inc = useIncome()
const { settings } = useSettings()
const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
const NOW = new Date(2026, 10, 20, 12) // 20 Nov 2026
const open = (name, extra = {}) => acc.addAccount({ name, type: 'bank', openingBalance: 1000, openingDate: '2026-11-01', ...extra })
const data = () => ({ expenses: ex.expenses, income: inc.income })
const lookups = { categoryName: (id) => ({ 'cat-food': 'Food', 'cat-travel': 'Travel' })[id] || '', incomeLabel: (t) => ({ salary: 'Salary' })[t] || t, accountName: (id) => acc.findAccount(id)?.name }

beforeEach(() => {
  acc.accounts.splice(0)
  acc.transfers.splice(0)
  acc.adjustments.splice(0)
  ex.expenses.splice(0)
  inc.income.splice(0)
  settings.cycleResetDay = 1
  settings.overallBudget = 10000
  for (const k of [...store.keys()]) if (k.startsWith('hisaab:accounts')) store.delete(k)
  installFakeIndexedDB()
})

// The scenario used by most tests: a bank, a cash box and a credit card, with income, expenses, a refund, a transfer, a
// card payment and one unassigned expense.
function seed() {
  const bank = open('Meezan', { openingBalance: 1000 })
  const cash = open('Cash', { type: 'cash', openingBalance: 200 })
  const card = open('Visa', { type: 'card', openingBalance: 0 })
  inc.addIncome({ date: noon(2026, 11, 1), amount: 5000, sourceType: 'salary', accountId: bank.id })
  ex.addExpense({ date: noon(2026, 11, 2), amount: 1200, categoryId: 'cat-food', note: 'Lunch', accountId: bank.id })
  ex.addExpense({ date: noon(2026, 11, 3), amount: 300, categoryId: 'cat-travel', accountId: cash.id })
  ex.addExpense({ date: noon(2026, 11, 4), amount: 100, categoryId: 'cat-food', kind: 'refund', note: 'Returned', accountId: bank.id })
  ex.addExpense({ date: noon(2026, 11, 5), amount: 500, categoryId: 'cat-food', accountId: card.id })
  ex.addExpense({ date: noon(2026, 11, 6), amount: 70, categoryId: 'cat-food', note: 'No account' })
  acc.addTransfer({ date: '2026-11-04', amount: 50, fromAccountId: bank.id, toAccountId: cash.id, note: 'top up' })
  acc.addTransfer({ date: '2026-11-07', amount: 500, fromAccountId: bank.id, toAccountId: card.id, note: 'pay card' })
  return { bank, cash, card }
}

// ---- the list ----------------------------------------------------------------------------------------------------------

test('accountCards: balances come from the pure maths; the card shows Owed/Paid off; archived accounts are separate and not in the total', () => {
  const { bank, cash, card } = seed()
  // bank 1000 + 5000 + 100 - 1200 - 50 - 500 = 4350 ; cash 200 - 300 + 50 = -50 ; card 0 - 500 + 500 = 0
  let v = accountCards(acc.store, data(), { now: NOW })
  const by = Object.fromEntries(v.active.map((c) => [c.name, c]))
  assert.equal(by.Meezan.balance, 4350)
  assert.equal(by.Cash.balance, -50)
  assert.equal(by.Cash.display.tone, 'warn')
  assert.match(by.Cash.display.hint, /Negative balance/, 'a negative cash balance is allowed, with a hint')
  assert.equal(by.Visa.display.label, 'Paid off')
  assert.equal(v.total, 4300)
  assert.equal(v.hasAccounts, true)

  ex.addExpense({ date: noon(2026, 11, 8), amount: 250, categoryId: 'cat-food', accountId: card.id })
  v = accountCards(acc.store, data(), { now: NOW })
  const owed = v.active.find((c) => c.name === 'Visa')
  assert.deepEqual([owed.balance, owed.display.label, owed.display.amount, owed.display.tone], [-250, 'Owed', 250, 'neutral'])
  assert.equal(v.total, 4050, "a card's debt subtracts")

  acc.archiveAccount(cash.id)
  v = accountCards(acc.store, data(), { now: NOW })
  assert.deepEqual(v.active.map((c) => c.name), ['Meezan', 'Visa'])
  assert.deepEqual(v.archived.map((c) => c.name), ['Cash'])
  assert.equal(v.total, 4350 - 250, 'archived accounts are not in the total')
  assert.equal(v.archived[0].balance, -50, 'but their balance is still computed')
  assert.equal(bank.id, v.active[0].id)
})

test('accountCards: an account with a broken opening date (hand-edited / restored) is flagged, left out of the total and does not crash the page', () => {
  seed()
  acc.accounts.push({ id: 'bad', name: 'Broken', type: 'bank', openingBalance: 99, openingDate: 'someday', archived: false, notes: '', order: 9, createdAt: '2026-11-01T00:00:00.000Z' })
  const v = accountCards(acc.store, data(), { now: NOW })
  const broken = v.active.find((c) => c.id === 'bad')
  assert.ok(broken.problem)
  assert.equal(broken.display, null)
  assert.equal(v.total, 4300, 'its 99 is not counted')
})

test('accountCards: empty store, input never mutated', () => {
  assert.deepEqual(accountCards({ accounts: [], transfers: [], adjustments: [] }, {}, { now: NOW }), { hasAccounts: false, active: [], archived: [], total: 0, byType: { cash: 0, bank: 0, wallet: 0, card: 0, other: 0 }, activeCount: 0 })
  assert.equal(accountCards(undefined, {}, { now: NOW }).hasAccounts, false)
  seed()
  const before = JSON.stringify([acc.store, ex.expenses, inc.income])
  accountCards(acc.store, data(), { now: NOW })
  ledgerView(acc.accounts[0], acc.store, data(), { now: NOW })
  assert.equal(JSON.stringify([acc.store, ex.expenses, inc.income]), before)
})

test('unassignedSummary: counts records without an account since the earliest active opening day; says nothing when there are none', () => {
  seed()
  let u = unassignedSummary(acc.store, data())
  assert.equal(u.count, 1)
  assert.equal(u.since, '2026-11-01')
  assert.match(u.text, /^1 transaction since .*Nov.* has no account$/)

  ex.addExpense({ date: noon(2026, 11, 9), amount: 5, categoryId: 'cat-food', accountId: 'gone' }) // an account that no longer exists = Unassigned
  inc.addIncome({ date: noon(2026, 11, 9), amount: 5, sourceType: 'salary' })
  u = unassignedSummary(acc.store, data())
  assert.equal(u.count, 3)
  assert.match(u.text, /^3 transactions since .* have no account$/)

  ex.addExpense({ date: noon(2026, 10, 15), amount: 5, categoryId: 'cat-food' }) // before every opening day: already inside the opening balance
  assert.equal(unassignedSummary(acc.store, data()).count, 3)
  assert.equal(unassignedSummary(acc.store, data(), '2026-11-08').count, 2, 'a later "since" day counts fewer')

  for (const a of acc.accounts) acc.archiveAccount(a.id)
  assert.deepEqual(unassignedSummary(acc.store, data()), { count: 0, since: null, text: '' }, 'no active account: nothing to say')
  assert.deepEqual(unassignedSummary({ accounts: [], transfers: [], adjustments: [] }, data()), { count: 0, since: null, text: '' })
})

// ---- the detail ledger ---------------------------------------------------------------------------------------------------

test('ledgerView: newest first, grouped by LOCAL day, running balance from the pure ledger, ends at the balance', () => {
  const { bank } = seed()
  const v = ledgerView(bank, acc.store, data(), { now: NOW, lookups })
  assert.deepEqual(v.groups.map((g) => g.dayKey), ['2026-11-07', '2026-11-04', '2026-11-02', '2026-11-01'], 'newest day first')
  const rows = v.groups.flatMap((g) => g.items)
  assert.equal(rows[0].running, v.balance.balance, 'the newest row carries the current balance')
  assert.equal(v.balance.balance, 4350)
  assert.equal(v.opening.running, 1000)
  assert.equal(v.opening.title, 'Opening balance')
  // chronological walk reproduces the same running balances
  let run = 1000
  for (const r of [...rows].reverse()) {
    run += r.amount
    assert.equal(r.running, run)
  }
  // day 11-04 has the refund (+100) and the transfer out (-50): net +50
  const d4 = v.groups.find((g) => g.dayKey === '2026-11-04')
  assert.equal(d4.items.length, 2)
  assert.equal(d4.net, 50)
  assert.equal(v.rowCount, 5)
})

test('ledgerView: every row has a TEXT label and a sign (colour is never the only signal); transfers name the other account', () => {
  const { bank, cash } = seed()
  const rows = ledgerView(bank, acc.store, data(), { now: NOW, lookups }).groups.flatMap((g) => g.items)
  const by = (label, pred = () => true) => rows.find((r) => r.label === label && pred(r))
  assert.deepEqual([by('Income').sign, by('Income').title, by('Income').subtitle], ['+', 'Salary', ''])
  assert.deepEqual([by('Expense').sign, by('Expense').title, by('Expense').subtitle], ['−', 'Lunch', 'Food'])
  assert.deepEqual([by('Refund').sign, by('Refund').title], ['+', 'Returned'])
  const out = rows.filter((r) => r.label === 'Transfer out')
  assert.deepEqual(out.map((r) => r.title).sort(), ['Transfer to Cash', 'Transfer to Visa'])
  assert.ok(out.every((r) => r.sign === '−' && r.editable && r.deletable))
  assert.ok(rows.every((r) => r.label && ['+', '−'].includes(r.sign)))
  assert.equal(by('Expense').editable, false, 'expenses are edited on the Expenses page, not here')
  // the other end of the same transfer
  const cashRows = ledgerView(cash, acc.store, data(), { now: NOW, lookups }).groups.flatMap((g) => g.items)
  const incoming = cashRows.find((r) => r.label === 'Transfer in')
  assert.deepEqual([incoming.title, incoming.sign, incoming.subtitle], ['Transfer from Meezan', '+', 'top up'])
})

test('ledgerView: a correction is its own labelled row; it moves the balance but is not an Expense/Income', () => {
  const { cash } = seed()
  const r = acc.reconcile(cash.id, { actual: 100, asOf: '2026-11-20' }) // computed -50 -> +150 correction
  assert.equal(r.adjustment.amount, 150)
  const v = ledgerView(cash, acc.store, data(), { now: NOW, lookups })
  const rows = v.groups.flatMap((g) => g.items)
  const c = rows.find((x) => x.type === 'correction')
  assert.deepEqual([c.label, c.title, c.sign, c.amount, c.reconciledTo, c.deletable, c.editable], ['Correction', 'Balance correction', '+', 150, 100, true, false])
  assert.equal(v.balance.balance, 100)
  assert.equal(v.balance.corrections, 150)
  assert.equal(rows[0].running, 100)
  assert.equal(rows.filter((x) => x.label === 'Expense' || x.label === 'Income').length, 1, 'only the one real expense; the correction is not one')
})

test('ledgerView: scheduled (future) rows are flagged and not in the balance; records older than the opening day are counted, not shown', () => {
  const { bank } = seed()
  ex.addExpense({ date: noon(2026, 11, 25), amount: 400, categoryId: 'cat-food', note: 'Next week', accountId: bank.id })
  ex.addExpense({ date: noon(2026, 10, 20), amount: 90, categoryId: 'cat-food', note: 'Before opening', accountId: bank.id })
  const v = ledgerView(bank, acc.store, data(), { now: NOW, lookups })
  assert.equal(v.balance.balance, 4350, 'neither affects the balance')
  assert.equal(v.olderThanOpening, 1)
  assert.equal(v.scheduledCount, 1)
  assert.equal(v.groups[0].dayKey, '2026-11-25')
  assert.equal(v.groups[0].scheduled, true)
  assert.equal(v.groups[1].scheduled, false)
  assert.equal(v.groups.flatMap((g) => g.items).some((r) => r.title === 'Before opening'), false)
})

test('ledgerView: an unreadable-date record is not listed and does not break the page', () => {
  const { bank } = seed()
  ex.addExpense({ date: 'garbage', amount: 5, categoryId: 'cat-food', accountId: bank.id })
  const v = ledgerView(bank, acc.store, data(), { now: NOW, lookups })
  assert.equal(v.balance.unreadable, 1)
  assert.equal(v.balance.balance, 4350)
})

test('describeRow: a transfer whose other account was deleted still reads sensibly', () => {
  const d = describeRow({ type: 'transfer-out', amount: -5, record: { toAccountId: 'gone', note: '' }, dayKey: '2026-11-01' }, { accountName: () => undefined })
  assert.equal(d.title, 'Transfer to a deleted account')
})

test('limitGroups never splits a day and reports what is hidden', () => {
  const g = (day, n) => ({ dayKey: day, items: Array.from({ length: n }, (_, i) => ({ id: `${day}-${i}` })) })
  const groups = [g('d3', 3), g('d2', 3), g('d1', 3)]
  let r = limitGroups(groups, 4)
  assert.deepEqual([r.groups.length, r.shown, r.total, r.hasMore], [2, 6, 9, true])
  r = limitGroups(groups, 100)
  assert.deepEqual([r.groups.length, r.shown, r.hasMore], [3, 9, false])
  assert.deepEqual(limitGroups([], 10), { groups: [], shown: 0, total: 0, hasMore: false })
})

// ---- transfer form helpers -----------------------------------------------------------------------------------------------

test('transferChoices / defaultTransferPair: only active accounts, plus an archived one the edited transfer already uses', () => {
  const { bank, cash, card } = seed()
  acc.archiveAccount(card.id)
  assert.deepEqual(transferChoices(acc.store).map((a) => a.name), ['Meezan', 'Cash'])
  assert.deepEqual(transferChoices(acc.store, [card.id]).map((a) => a.name), ['Meezan', 'Cash', 'Visa'])
  assert.deepEqual(defaultTransferPair(acc.store, cash.id), { fromAccountId: cash.id, toAccountId: bank.id })
  assert.deepEqual(defaultTransferPair(acc.store), { fromAccountId: bank.id, toAccountId: cash.id })
  assert.deepEqual(defaultTransferPair(acc.store, card.id), { fromAccountId: bank.id, toAccountId: cash.id }, 'an archived preferred account is not offered')
  acc.archiveAccount(cash.id)
  assert.deepEqual(defaultTransferPair(acc.store), { fromAccountId: bank.id, toAccountId: '' }, 'one active account: no valid pair yet')
})

// ---- the reconcile dialog ------------------------------------------------------------------------------------------------

test('reconcileView: bad typing never throws; days are checked', () => {
  const { bank } = seed()
  const rv = (o) => reconcileView(bank, acc.store, data(), { now: NOW, ...o })
  assert.equal(rv({ actual: '' }).valid, false)
  assert.equal(rv({ actual: 'abc' }).valid, false)
  assert.match(rv({ actual: 'abc' }).error, /real balance as a number/)
  assert.match(rv({ actual: 10, asOf: 'tomorrow' }).error, /valid day/)
  assert.match(rv({ actual: 10, asOf: '2026-11-21' }).error, /today or an earlier day/)
  assert.match(rv({ actual: 10, asOf: '2026-10-31' }).error, /before the account's opening date/)
  assert.equal(rv({ actual: 10 }).valid, true, 'no day = today')
})

test('reconcileView: match / higher / lower with exact cents and a hint pointing at missing records', () => {
  const { bank } = seed()
  const format = (n) => `Rs ${n}`
  const rv = (actual, asOf) => reconcileView(bank, acc.store, data(), { now: NOW, actual, asOf, format })
  const same = rv(4350)
  assert.deepEqual([same.valid, same.direction, same.needsCorrection, same.difference], [true, 'match', false, 0])
  assert.match(same.message, /No correction is needed/)
  assert.equal(same.hint, '')

  const up = rv('4350.10')
  assert.deepEqual([up.direction, up.difference, up.expected, up.actual], ['higher', 0.1, 4350, 4350.1])
  assert.match(up.message, /Rs 0.1 higher.*\+Rs 0.1/)
  assert.match(up.hint, /missing transaction/)
  assert.match(up.hint, /1 transaction since .* has no account/, 'mentions the unassigned record')

  const down = rv(4000)
  assert.deepEqual([down.direction, down.difference], ['lower', -350])
  assert.match(down.message, /Rs 350 lower.*−Rs 350/)
  assert.equal(floatSafe(rv(0.3).difference), -4349.7)
})
const floatSafe = (n) => Math.round(n * 100) / 100

test('reconcile (store) uses what the dialog previewed: one visible correction, dated the chosen day, and Undo removes it', () => {
  const { bank } = seed()
  const preview = reconcileView(bank, acc.store, data(), { now: NOW, actual: 4000, asOf: '2026-11-20' })
  const done = acc.reconcile(bank.id, { actual: 4000, asOf: '2026-11-20' })
  assert.equal(done.adjustment.amount, preview.difference)
  assert.equal(localDayKey(done.adjustment.date), '2026-11-20')
  assert.equal(accountBalance(bank, { ...data(), transfers: acc.transfers, adjustments: acc.adjustments }, { now: NOW }).balance, 4000)
  acc.deleteAdjustment(done.adjustment.id)
  assert.equal(acc.balanceOf(bank.id, { now: NOW }).balance, 4350)
  acc.undoDeleteAdjustment()
  assert.equal(acc.balanceOf(bank.id, { now: NOW }).balance, 4000, 'Undo brings the correction back')
  assert.equal(acc.reconcile(bank.id, { actual: 4000, asOf: '2026-11-20' }).adjustment, null, 'matching balance: nothing added')
})

// ---- transfers / corrections never touch spending ---------------------------------------------------------------------

function everyFigure() {
  const b = useBudget(NOW)
  const all = filterTransactions(ex.expenses, { period: 'all' })
  const month = filterTransactions(ex.expenses, { period: 'this-month', now: NOW })
  return JSON.stringify({
    // Dashboard + Budget
    spent: b.cycleSpent.value,
    gross: b.cycleGross.value,
    refunds: b.cycleRefunds.value,
    remaining: b.overallRemaining.value,
    percent: b.overallPercentUsed.value,
    safe: b.safeToSpendPerDay.value,
    income: b.cycleIncome.value,
    cashflow: b.netCashflow.value,
    savings: b.savingsRate.value,
    daily: b.dailyAverageThisCycle.value,
    previous: b.previousCycleSpent.value,
    alerts: b.alerts.value,
    cats: b.categoryBreakdown.value.map((r) => [r.category.id, r.spent]),
    cycleList: b.cycleExpenses.value.map((e) => e.id),
    // Expenses page
    expensesAll: summarize(all, { now: NOW }),
    expensesMonth: summarize(month, { now: NOW }),
    // CSV
    csv: transactionsToCsv(ex.expenses),
    // the raw records
    rawExpenses: JSON.stringify(ex.expenses),
    rawIncome: JSON.stringify(inc.income),
  })
}

test('a transfer, an edited transfer, a correction and their Undo leave the Dashboard, Budget, Expenses and CSV figures exactly as they were', () => {
  const { bank, cash, card } = seed()
  const before = everyFigure()
  const sanity = JSON.parse(before)
  assert.ok(sanity.expensesAll.net > 0 && sanity.spent > 0, 'the scenario has real spending to protect')

  const t = acc.addTransfer({ date: '2026-11-10', amount: 777, fromAccountId: cash.id, toAccountId: bank.id, note: 'more' })
  assert.equal(everyFigure(), before, 'new transfer')
  acc.updateTransfer(t.id, { amount: 1234.56, fromAccountId: card.id })
  assert.equal(everyFigure(), before, 'edited transfer')
  acc.reconcile(bank.id, { actual: 99999, asOf: '2026-11-20' })
  assert.equal(everyFigure(), before, 'correction')
  acc.deleteTransfer(t.id)
  assert.equal(everyFigure(), before, 'deleted transfer')
  acc.undoDeleteTransfer()
  assert.equal(everyFigure(), before, 'undone delete')
  acc.deleteAdjustment(acc.adjustments[0].id)
  assert.equal(everyFigure(), before, 'deleted correction')
  acc.archiveAccount(cash.id)
  assert.equal(everyFigure(), before, 'archived account')
  assert.equal(ex.expenses.length, 5, 'no expense was created by any of it')
  assert.equal(inc.income.length, 1, 'no income was created either')
})

test('...while the account balances DO move (so the test above is not vacuous)', () => {
  const { bank, cash } = seed()
  const b0 = accountCards(acc.store, data(), { now: NOW })
  acc.addTransfer({ date: '2026-11-10', amount: 100, fromAccountId: cash.id, toAccountId: bank.id })
  const b1 = accountCards(acc.store, data(), { now: NOW })
  const bal = (v, id) => v.active.find((c) => c.id === id).balance
  assert.equal(bal(b1, bank.id), bal(b0, bank.id) + 100)
  assert.equal(bal(b1, cash.id), bal(b0, cash.id) - 100)
  assert.equal(b1.total, b0.total, 'a transfer leaves the total unchanged')
})

// ---- source guards ---------------------------------------------------------------------------------------------------

test('the Accounts screens hold no money maths: they use useAccounts + accountsView.js only', () => {
  const root = new URL('../src/', import.meta.url)
  const files = [
    ...readdirSync(new URL('views/', root)).filter((f) => /^Account/.test(f)).map((f) => `views/${f}`),
    ...readdirSync(new URL('components/', root)).filter((f) => /^(Account|Transfer|Reconcile)/.test(f)).map((f) => `components/${f}`),
  ]
  assert.ok(files.length >= 5, `expected the new screens, found: ${files.join(', ')}`)
  for (const f of files) {
    const text = readFileSync(fileURLToPath(new URL(f, root)), 'utf8')
    assert.doesNotMatch(text, /from '\.\.\/utils\/accounts\.js'/, `${f} must not do account maths itself`)
    assert.doesNotMatch(text, /\.reduce\(/, `${f} must not sum amounts`)
    assert.doesNotMatch(text, /openingBalance\s*[+\-]|running\s*[+\-]=/, `${f} must not compute balances`)
    assert.doesNotMatch(text, /useBudget|computeBudget|localStorage/, `${f} must not touch budget or storage directly`)
    // One list of "records that move money" lives in useAccounts().records(); a screen that assembled its own list once
    // forgot a record kind (investments) and showed a wrong ledger, so the screens may not import those stores at all.
    assert.doesNotMatch(text, /\buse(Expenses|Income|Lending|Investments)\(/, `${f} must get its records from useAccounts().records()`)
  }
})

// ---- Phase 2.4: picker + bulk assign ---------------------------------------------------------------------------------

import { accountPickerChoices, initialAccountId, assignmentPlan } from '../src/utils/accountsView.js'
const acct = (id, openingBalance, openingDate, extra = {}) => ({ id, name: id, type: 'bank', openingBalance, openingDate, archived: false, order: 0, ...extra })

test('accountPickerChoices: empty without accounts (picker hidden); active only; archived kept when it is the record\'s own', () => {
  assert.deepEqual(accountPickerChoices({ accounts: [], transfers: [], adjustments: [] }), [])
  assert.deepEqual(accountPickerChoices(null), [])
  const store = { accounts: [acct('b', 0, '2026-11-01', { order: 1 }), acct('a', 0, '2026-11-01', { order: 0 }), acct('z', 0, '2026-11-01', { archived: true, order: 2 })] }
  assert.deepEqual(accountPickerChoices(store).map((x) => x.id), ['a', 'b'])
  assert.deepEqual(accountPickerChoices(store, 'z').map((x) => x.id), ['a', 'b', 'z'])
})

test('initialAccountId: create = last used (if active) else default (if active) else none; edit = own account if it exists', () => {
  const store = { accounts: [acct('a', 0, '2026-11-01'), acct('b', 0, '2026-11-01'), acct('z', 0, '2026-11-01', { archived: true })] }
  assert.equal(initialAccountId(store, { lastAccountId: 'b', defaultAccountId: 'a' }), 'b')
  assert.equal(initialAccountId(store, { lastAccountId: 'z', defaultAccountId: 'a' }), 'a', 'archived last account is skipped')
  assert.equal(initialAccountId(store, { lastAccountId: 'gone', defaultAccountId: 'gone' }), '', 'unknown ids give none')
  assert.equal(initialAccountId(store, {}), '')
  assert.equal(initialAccountId({ accounts: [] }, { lastAccountId: 'a' }), '')
  assert.equal(initialAccountId(store, { mode: 'edit', current: 'z', lastAccountId: 'a' }), 'z', 'edit keeps even an archived own account')
  assert.equal(initialAccountId(store, { mode: 'edit', current: 'deleted', lastAccountId: 'a' }), '', 'edit of an orphaned id starts as none, not the last account')
  assert.equal(initialAccountId(store, { mode: 'edit', current: '' }), '')
})

test('assignmentPlan: lists only real changes, supports removing the account, never mutates', () => {
  const recs = [
    { id: 'r1', accountId: 'a' },
    { id: 'r2' },
    { id: 'r3', accountId: 'b' },
    { id: 'r4', accountId: '' },
    { id: 'r5', accountId: 'a' },
  ]
  const snapshot = JSON.stringify(recs)
  const p = assignmentPlan(recs, ['r1', 'r2', 'r3', 'r4', 'nope'], 'a')
  assert.deepEqual(p.changes, [{ id: 'r2', from: '', to: 'a' }, { id: 'r3', from: 'b', to: 'a' }, { id: 'r4', from: '', to: 'a' }])
  assert.equal(p.count, 3)
  assert.equal(p.unchanged, 1, 'r1 already has it; r5 was not selected')
  const rm = assignmentPlan(recs, ['r1', 'r2', 'r3', 'r4'], '')
  assert.deepEqual(rm.changes.map((c) => c.id), ['r1', 'r3'], 'removing only touches records that have an account')
  assert.equal(JSON.stringify(recs), snapshot)
  assert.deepEqual(assignmentPlan([], ['x'], 'a'), { changes: [], count: 0, unchanged: 0 })
})
