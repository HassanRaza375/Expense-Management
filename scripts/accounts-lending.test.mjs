// Phase 2.5: loans and repayments as account movements (src/utils/accounts.js). Lending is money moving, never spending
// or income: nothing here may change a spending, budget or income figure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountBalance, accountsOverview, accountLedger } from '../app/utils/accounts.js'
import { describeRow } from '../app/utils/accountsView.js'
import { summarize } from '../app/utils/reporting.js'

const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
const NOW = new Date(2026, 10, 20, 12)
const acct = (id, openingBalance, openingDate = '2026-11-01', extra = {}) => ({ id, name: id, type: 'bank', openingBalance, openingDate, archived: false, order: 0, ...extra })
let seq = 0
const loan = (extra) => ({ id: `l${++seq}`, direction: 'lent', personName: 'Ali', amount: 1000, date: noon(2026, 11, 3), repayments: [], createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...extra })
const rep = (extra) => ({ id: `r${++seq}`, date: noon(2026, 11, 8), amount: 400, notes: '', createdAt: new Date(2026, 0, 2, 0, 0, seq).toISOString(), ...extra })

test('a loan you LENT leaves the account; each repayment received comes back', () => {
  const a = acct('bank', 5000)
  const loans = [loan({ accountId: 'bank', repayments: [rep({ accountId: 'bank', amount: 400 }), rep({ accountId: 'bank', amount: 100, date: noon(2026, 11, 9) })] })]
  const b = accountBalance(a, { loans }, { now: NOW })
  assert.equal(b.lendingOut, 1000)
  assert.equal(b.lendingIn, 500)
  assert.equal(b.balance, 5000 - 1000 + 500)
})

test('a loan you BORROWED arrives in the account; each repayment you make leaves it', () => {
  const a = acct('bank', 100)
  const loans = [loan({ direction: 'borrowed', accountId: 'bank', amount: 800, repayments: [rep({ accountId: 'bank', amount: 300 })] })]
  const b = accountBalance(a, { loans }, { now: NOW })
  assert.equal(b.lendingIn, 800)
  assert.equal(b.lendingOut, 300)
  assert.equal(b.balance, 100 + 800 - 300)
})

test('a loan paid from one account can be repaid into another (each side counts on ITS account)', () => {
  const bank = acct('bank', 5000)
  const cash = acct('cash', 0, '2026-11-01', { type: 'cash' })
  const loans = [loan({ accountId: 'bank', repayments: [rep({ accountId: 'cash', amount: 250 })] })]
  assert.equal(accountBalance(bank, { loans }, { now: NOW }).balance, 4000)
  assert.equal(accountBalance(cash, { loans }, { now: NOW }).balance, 250)
})

test('loans and repayments with no account, an unknown account, or dated before the opening day / in the future never touch a balance', () => {
  const a = acct('bank', 1000, '2026-11-05')
  const loans = [
    loan({}), // no account
    loan({ accountId: 'gone' }), // unknown account
    loan({ accountId: 'bank', date: noon(2026, 11, 2) }), // before the opening day
    loan({ accountId: 'bank', date: noon(2026, 12, 25) }), // future
    loan({ accountId: 'bank', date: noon(2026, 11, 6), amount: 10, repayments: [rep({ date: noon(2026, 11, 7), amount: 5 })] }), // repayment has no account
  ]
  const b = accountBalance(a, { loans }, { now: NOW })
  assert.equal(b.balance, 990, 'only the one valid 10 loan counts')
  assert.equal(b.olderThanOpening, 1)
  assert.equal(b.scheduled, 1)
})

test('legacy loans without a direction count as lent; missing/odd fields never throw', () => {
  const a = acct('bank', 1000)
  const legacy = { id: 'old', borrowerName: 'Sara', amount: 200, date: noon(2026, 11, 3), accountId: 'bank', repayments: [] }
  assert.equal(accountBalance(a, { loans: [legacy] }, { now: NOW }).balance, 800)
  assert.doesNotThrow(() => accountBalance(a, { loans: [null, {}, { repayments: 'x' }, { accountId: 'bank', amount: 'abc', date: 'nope' }] }, { now: NOW }))
  assert.doesNotThrow(() => accountBalance(a, { loans: 'not an array' }, { now: NOW }))
})

test('ledger: lending rows are labelled, signed, and the last running balance equals the balance', () => {
  const a = acct('bank', 5000)
  const loans = [loan({ accountId: 'bank', personName: 'Ali', repayments: [rep({ accountId: 'bank', amount: 400 })] }), loan({ direction: 'borrowed', accountId: 'bank', personName: 'Sara', amount: 300, date: noon(2026, 11, 4) })]
  const rows = accountLedger(a, { loans }, { now: NOW })
  assert.deepEqual(rows.map((r) => r.type), ['opening', 'loan-out', 'loan-in', 'repayment-in'])
  assert.equal(rows.at(-1).running, accountBalance(a, { loans }, { now: NOW }).balance)
  const titles = rows.slice(1).map((r) => describeRow(r).title)
  assert.deepEqual(titles, ['Loan to Ali', 'Loan from Sara', 'Repayment from Ali'])
  for (const r of rows.slice(1)) {
    const d = describeRow(r)
    assert.ok(d.label)
    assert.equal(d.editable, false)
    assert.equal(d.deletable, false, 'lending rows are managed on the Lending page')
  }
})

test('invariant: sum of balances = sum of openings + income + refunds - expenses + corrections + (lending in - out), and transfers net to zero', () => {
  const accounts = [acct('a', 1000), acct('b', 200, '2026-11-01', { type: 'cash' })]
  const loans = [loan({ accountId: 'a', amount: 300, repayments: [rep({ accountId: 'b', amount: 120 })] })]
  const store = { accounts, transfers: [{ id: 't', date: noon(2026, 11, 5), amount: 50, fromAccountId: 'a', toAccountId: 'b', createdAt: '2026-11-05T00:00:00.000Z' }], adjustments: [] }
  const o = accountsOverview(store, { expenses: [], income: [], loans }, { now: NOW })
  assert.equal(o.total, 1000 + 200 - 300 + 120)
})

test('lending is NOT spending or income: figures from reporting do not see loans at all', () => {
  const expenses = [{ id: 'e', date: noon(2026, 11, 2), amount: 100, categoryId: 'food', note: '', createdAt: '2026-11-02T00:00:00.000Z' }]
  const before = JSON.stringify(summarize(expenses, { now: NOW }))
  accountBalance(acct('bank', 1000), { expenses, loans: [loan({ accountId: 'bank' })] }, { now: NOW })
  assert.equal(JSON.stringify(summarize(expenses, { now: NOW })), before)
})

// ---- Phase 4: investment contributions / withdrawals as account movements --------------------------------------------

test('a contribution to a fund leaves the account; a withdrawal arrives; neither is spending or income', () => {
  const a = acct('bank', 5000)
  const funds = [
    {
      id: 'f1',
      name: 'Index fund',
      contributions: [{ id: 'c1', date: noon(2026, 11, 3), amount: 2000, accountId: 'bank' }, { id: 'c2', date: noon(2026, 11, 4), amount: 999 }],
      withdrawals: [{ id: 'w1', date: noon(2026, 11, 9), amount: 500, accountId: 'bank' }],
      valueEntries: [],
    },
  ]
  const b = accountBalance(a, { funds }, { now: NOW })
  assert.equal(b.investmentOut, 2000)
  assert.equal(b.investmentIn, 500)
  assert.equal(b.balance, 5000 - 2000 + 500, 'the contribution without an account touches nothing')
  const rows = accountLedger(a, { funds }, { now: NOW })
  assert.deepEqual(rows.map((r) => r.type), ['opening', 'investment-out', 'investment-in'])
  assert.equal(rows.at(-1).running, b.balance)
  const titles = rows.slice(1).map((r) => describeRow(r).title)
  assert.deepEqual(titles, ['Contribution to Index fund', 'Withdrawal from Index fund'])
  for (const r of rows.slice(1)) {
    const d = describeRow(r)
    assert.ok(d.label)
    assert.equal(d.deletable, false, 'managed on the Investments page')
  }
})

test('funds with missing/odd shapes never throw; a fund record dated before the opening day or in the future is not counted', () => {
  const a = acct('bank', 1000, '2026-11-05')
  assert.doesNotThrow(() => accountBalance(a, { funds: [null, {}, { contributions: 'x' }, { contributions: [null, { accountId: 'bank', amount: 'abc', date: 'nope' }] }] }, { now: NOW }))
  const funds = [{ id: 'f', name: 'F', contributions: [{ id: 'old', date: noon(2026, 11, 2), amount: 10, accountId: 'bank' }, { id: 'future', date: noon(2026, 12, 30), amount: 20, accountId: 'bank' }, { id: 'ok', date: noon(2026, 11, 6), amount: 5, accountId: 'bank' }] }]
  const b = accountBalance(a, { funds }, { now: NOW })
  assert.equal(b.balance, 995)
  assert.equal(b.olderThanOpening, 1)
  assert.equal(b.scheduled, 1)
})

test('ledger tie-break: a loan / contribution is listed before its repayment / withdrawal even with identical day, creation time and an unlucky id order', () => {
  const a = acct('bank', 1000)
  const same = new Date(2026, 10, 3, 10, 0, 0).toISOString()
  for (const ids of [['z-loan', 'a-repay'], ['a-loan', 'z-repay']]) {
    const loans = [{ id: ids[0], direction: 'lent', personName: 'Ali', amount: 300, date: noon(2026, 11, 3), accountId: 'bank', createdAt: same, repayments: [{ id: ids[1], date: noon(2026, 11, 3), amount: 100, accountId: 'bank', createdAt: same }] }]
    assert.deepEqual(accountLedger(a, { loans }, { now: NOW }).map((r) => r.type), ['opening', 'loan-out', 'repayment-in'])
  }
  const funds = [{ id: 'f', name: 'F', contributions: [{ id: 'z', date: noon(2026, 11, 3), amount: 50, accountId: 'bank', createdAt: same }], withdrawals: [{ id: 'a', date: noon(2026, 11, 3), amount: 20, accountId: 'bank', createdAt: same }] }]
  assert.deepEqual(accountLedger(a, { funds }, { now: NOW }).map((r) => r.type), ['opening', 'investment-out', 'investment-in'])
})
