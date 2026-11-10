// Phase 3: net worth, its history and cash flow by cycle (src/utils/netWorth.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { netWorthAt, netWorthSeries, unlinkedInvestmentCount, cashFlowByCycle } from '../src/utils/netWorth.js'
import { accountsOverview } from '../src/utils/accounts.js'
import { computeBudget, cycleIncome } from '../src/utils/budgetMath.js'
import { summarize, currentCycle } from '../src/utils/reporting.js'

const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
const NOW = new Date(2026, 10, 20, 12) // 20 Nov 2026
let seq = 0
const base = (extra) => ({ id: `r${++seq}`, createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...extra })
const exp = (date, amount, accountId, extra = {}) => base({ date, amount, accountId, categoryId: 'food', note: '', ...extra })
const inc = (date, amount, accountId) => base({ date, amount, accountId, sourceType: 'salary' })
const acct = (id, openingBalance, openingDate, extra = {}) => ({ id, name: id, type: 'bank', openingBalance, openingDate, archived: false, order: 0, ...extra })

const world = () => ({
  accounts: { accounts: [acct('bank', 10000, '2026-06-01'), acct('visa', -2000, '2026-06-01', { type: 'card' })], transfers: [], adjustments: [] },
  expenses: [exp(noon(2026, 7, 5), 1000, 'bank')],
  income: [inc(noon(2026, 7, 1), 5000, 'bank')],
  assets: [{ id: 'a1', name: 'Laptop', purchaseDate: noon(2026, 8, 1), currentValue: 60000 }, { id: 'a2', name: 'Old phone', purchaseDate: null, createdAt: noon(2026, 6, 15), currentValue: 5000 }],
  funds: [{ id: 'f1', name: 'Fund', contributions: [{ id: 'c1', date: noon(2026, 9, 1), amount: 20000 }], valueEntries: [{ id: 'v1', date: noon(2026, 10, 1), value: 22000 }], withdrawals: [] }],
  loans: [
    { id: 'l1', direction: 'lent', personName: 'Ali', amount: 3000, date: noon(2026, 9, 10), repayments: [{ id: 'p1', date: noon(2026, 10, 10), amount: 1000 }] },
    { id: 'l2', direction: 'borrowed', personName: 'Sara', amount: 800, date: noon(2026, 10, 5), repayments: [] },
  ],
})

test('net worth = accounts + assets + investments + lent - borrowed (a credit card subtracts)', () => {
  const w = world()
  const n = netWorthAt('2026-11-20', w)
  assert.equal(n.accounts, 10000 + 5000 - 1000 - 2000, 'bank 14000, card -2000 -> 12000')
  assert.equal(n.assets, 65000)
  assert.equal(n.investments, 22000)
  assert.equal(n.receivable, 2000)
  assert.equal(n.payable, 800)
  assert.equal(n.total, 12000 + 65000 + 22000 + 2000 - 800)
  assert.deepEqual(n.accountList.map((a) => a.id), ['bank', 'visa'])
})

test('archived accounts are left out (like the Accounts total); accounts count only from their opening day', () => {
  const w = world()
  w.accounts.accounts.push(acct('old', 777, '2026-01-01', { archived: true }))
  assert.equal(netWorthAt('2026-11-20', w).accounts, 12000)
  assert.equal(netWorthAt('2026-05-31', w).accounts, 0, 'before the first opening day nothing was tracked')
  assert.equal(netWorthAt('2026-06-01', w).accounts, 10000 - 2000)
})

test('the account part equals the Accounts page total (accountsOverview) on the same day', () => {
  const w = world()
  const o = accountsOverview(w.accounts, { expenses: w.expenses, income: w.income, loans: w.loans, funds: w.funds }, { asOf: '2026-11-20' })
  assert.equal(netWorthAt('2026-11-20', w).accounts, o.total)
})

test('history is exact for past days: loans, fund values and assets by date', () => {
  const w = world()
  assert.equal(netWorthAt('2026-07-31', w).assets, 5000, 'the laptop was bought on 1 Aug; the phone has no purchase date so it counts from the day it was added (15 Jun)')
  assert.equal(netWorthAt('2026-08-31', w).assets, 65000)
  assert.equal(netWorthAt('2026-09-30', w).receivable, 3000)
  assert.equal(netWorthAt('2026-10-31', w).receivable, 2000, 'repayment of 1000 on 10 Oct')
  assert.equal(netWorthAt('2026-10-31', w).payable, 800)
  assert.equal(netWorthAt('2026-09-15', w).investments, 20000, 'no value entry yet: value = contributions')
  assert.equal(netWorthAt('2026-10-31', w).investments, 22000)
})

test('a loan from an account does not change net worth by itself (cash out, claim in)', () => {
  const w = { accounts: { accounts: [acct('bank', 10000, '2026-01-01')], transfers: [], adjustments: [] }, loans: [] }
  const before = netWorthAt('2026-11-20', w).total
  w.loans = [{ id: 'l', direction: 'lent', personName: 'Ali', amount: 4000, date: noon(2026, 11, 2), accountId: 'bank', repayments: [] }]
  assert.equal(netWorthAt('2026-11-20', w).total, before)
})

test('a fund contribution FROM an account does not change net worth by itself either (if the fund is worth what went in)', () => {
  const w = { accounts: { accounts: [acct('bank', 10000, '2026-01-01')], transfers: [], adjustments: [] }, funds: [] }
  const before = netWorthAt('2026-11-20', w).total
  w.funds = [{ id: 'f', name: 'F', contributions: [{ id: 'c', date: noon(2026, 11, 2), amount: 3000, accountId: 'bank' }], valueEntries: [], withdrawals: [] }]
  assert.equal(netWorthAt('2026-11-20', w).total, before)
  // without the account link the money is counted twice - exactly what unlinkedInvestmentCount warns about
  w.funds[0].contributions[0].accountId = undefined
  assert.equal(netWorthAt('2026-11-20', w).total, before + 3000)
  assert.equal(unlinkedInvestmentCount(w), 1)
})

test('a transfer moves money between accounts and leaves net worth unchanged', () => {
  const w = { accounts: { accounts: [acct('a', 1000, '2026-01-01'), acct('b', 0, '2026-01-01', { type: 'cash' })], transfers: [], adjustments: [] } }
  const before = netWorthAt('2026-11-20', w).total
  w.accounts.transfers = [{ id: 't', date: noon(2026, 11, 3), amount: 400, fromAccountId: 'a', toAccountId: 'b', createdAt: '2026-11-03T00:00:00.000Z' }]
  assert.equal(netWorthAt('2026-11-20', w).total, before)
})

test('empty and odd inputs never throw and give zero', () => {
  assert.equal(netWorthAt('2026-11-20', {}).total, 0)
  assert.equal(netWorthAt('2026-11-20', {}).tracked, false)
  assert.doesNotThrow(() => netWorthAt('2026-11-20', { accounts: { accounts: [null, { openingDate: 'x' }] }, assets: [null, { currentValue: 'abc' }], funds: [null, {}], loans: [null, { amount: 'x' }] }))
  assert.throws(() => netWorthAt('nope', {}), RangeError)
})

test('netWorthSeries: month ends oldest first, ends today, leaves out months before anything was tracked', () => {
  const w = world()
  const s = netWorthSeries(w, { now: NOW, months: 12 })
  assert.equal(s.at(-1).dayKey, '2026-11-20')
  assert.deepEqual(s.map((p) => p.dayKey).slice(0, 2), ['2026-06-30', '2026-07-31'], 'tracking starts in the first month something exists (the account opened 1 Jun)')
  assert.ok(s.every((p, i) => i === 0 || p.dayKey > s[i - 1].dayKey))
  assert.equal(s.at(-1).total, netWorthAt('2026-11-20', w).total)
  assert.deepEqual(netWorthSeries({}, { now: NOW }), [])
})

test('cashFlowByCycle: the current cycle equals the Dashboard/Budget figures; savings rate null without income', () => {
  const resetDay = 6
  const expenses = [exp(noon(2026, 11, 8), 700), exp(noon(2026, 11, 9), 300, undefined, { kind: 'refund' }), exp(noon(2026, 10, 20), 400)]
  const income = [inc(noon(2026, 11, 7), 2000), inc(noon(2026, 9, 7), 1000)]
  const rows = cashFlowByCycle({ expenses, income, resetDay, now: NOW, cycles: 3 })
  assert.equal(rows.length, 3)
  assert.equal(rows[0].isCurrent, true)
  const b = computeBudget({ expenses, income, resetDay, now: NOW, overallBudget: 0, categoryBudgets: {}, categories: [] })
  assert.equal(rows[0].spent, b.spent)
  assert.equal(rows[0].income, b.cycleIncome)
  assert.equal(rows[0].net, b.netCashflow)
  assert.equal(rows[0].spent, 400, '700 spent - 300 refunded')
  assert.equal(rows[0].net, 1600)
  assert.equal(rows[0].savingsRate, 80)
  assert.equal(rows[1].income, 0)
  assert.equal(rows[1].savingsRate, null, 'no income: no rate')
  assert.ok(rows[0].startKey > rows[1].startKey && rows[1].startKey > rows[2].startKey, 'newest first')
  assert.equal(cycleIncome(income, currentCycle(NOW, resetDay)), rows[0].income)
  assert.equal(summarize(expenses.filter((e) => e.date >= noon(2026, 11, 6))).net, rows[0].spent)
})

test('cashFlowByCycle works for reset days 29-31 (no overlapping or skipped cycles)', () => {
  for (const resetDay of [1, 28, 29, 30, 31]) {
    const rows = cashFlowByCycle({ expenses: [], income: [], resetDay, now: NOW, cycles: 8 })
    for (let i = 1; i < rows.length; i++) {
      const next = new Date(rows[i].endKey + 'T00:00:00Z')
      next.setUTCDate(next.getUTCDate() + 1)
      assert.equal(next.toISOString().slice(0, 10), rows[i - 1].startKey, `reset day ${resetDay}: cycles are contiguous`)
    }
  }
})

test('the overview module never reads the app state: it imports only pure modules', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/utils/netWorth.js', import.meta.url)), 'utf8')
  assert.doesNotMatch(src, /from 'vue'|useAccounts|storage\.js|localStorage/)
})
