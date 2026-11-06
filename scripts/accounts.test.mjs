// Phase 2.1: pure account math (src/utils/accounts.js) and the invariants from the design (section K.4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  ACCOUNT_TYPES,
  accountBalance,
  accountsOverview,
  accountLedger,
  unassignedSince,
  reconcileDifference,
  validateAccount,
  validateTransfer,
  validateAdjustment,
  balanceDisplay,
} from '../src/utils/accounts.js'
import { localDayKey, addDays } from '../src/utils/reporting.js'

let seq = 0
const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString() // what the forms store now
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).toISOString() // "now"-style instants
const picked = (key) => new Date(key).toISOString() // OLD date-picker format (UTC midnight)
const pickerSafe = new Date('2026-11-02').getTimezoneOffset() <= 0
const cents = (n) => Math.round(n * 100)
const base = (extra) => ({ id: `r${++seq}`, createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...extra })
const exp = (date, amount, accountId, extra = {}) => base({ date, amount, accountId, categoryId: 'food', note: '', ...extra })
const refund = (date, amount, accountId) => exp(date, amount, accountId, { kind: 'refund' })
const inc = (date, amount, accountId) => base({ date, amount, accountId, sourceType: 'salary' })
const transfer = (date, amount, fromAccountId, toAccountId) => base({ date, amount, fromAccountId, toAccountId })
const fix = (date, amount, accountId) => base({ date, amount, accountId })
const acct = (id, openingBalance, openingDate, extra = {}) => ({ id, name: id, type: 'bank', openingBalance, openingDate, archived: false, order: 0, ...extra })
const NOW = new Date(2026, 10, 20, 12) // 20 Nov 2026

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.values(o).forEach(deepFreeze)
  }
  return o
}

// ---- the rule ------------------------------------------------------------------------------------------------------

test('balance = opening + income + refunds - expenses + transfers in - transfers out + corrections', () => {
  const A = acct('A', 1000, '2026-11-01')
  const data = {
    expenses: [exp(noon(2026, 11, 4), 200, 'A'), refund(noon(2026, 11, 5), 50, 'A')],
    income: [inc(noon(2026, 11, 3), 500, 'A')],
    transfers: [transfer(noon(2026, 11, 6), 100, 'A', 'B'), transfer(noon(2026, 11, 7), 40, 'B', 'A')],
    adjustments: [fix(noon(2026, 11, 8), -10, 'A')],
  }
  const b = accountBalance(A, data, { now: NOW })
  assert.equal(b.balance, 1000 + 500 + 50 - 200 + 40 - 100 - 10)
  assert.deepEqual([b.income, b.refunds, b.expenses, b.transfersIn, b.transfersOut, b.corrections], [500, 50, 200, 40, 100, -10])
  assert.equal(b.counted, 6)
})

test('the opening day counts (the opening balance is the balance at the START of that day); earlier days are ignored but flagged', () => {
  const A = acct('A', 100, '2026-11-10')
  const data = {
    expenses: [exp(at(2026, 11, 10, 0, 5), 10, 'A'), exp(at(2026, 11, 9, 23, 55), 999, 'A')],
    income: [inc(noon(2026, 11, 1), 5000, 'A')],
  }
  const b = accountBalance(A, data, { now: NOW })
  assert.equal(b.balance, 90)
  assert.equal(b.olderThanOpening, 2, 'two assigned records predate the opening day')
  assert.equal(b.counted, 1)
})

test('asOf is inclusive; later records are "scheduled", not counted yet; unreadable dates are reported', () => {
  const A = acct('A', 0, '2026-11-01')
  const data = { income: [inc(noon(2026, 11, 20), 10, 'A'), inc(at(2026, 11, 20, 23, 59), 5, 'A'), inc(noon(2026, 11, 21), 100, 'A'), inc('nope', 7, 'A')] }
  const b = accountBalance(A, data, { now: NOW })
  assert.deepEqual([b.balance, b.scheduled, b.unreadable], [15, 1, 1])
  assert.equal(accountBalance(A, data, { asOf: '2026-11-21' }).balance, 115, 'an explicit asOf day')
  assert.equal(accountBalance(A, data, { asOf: noon(2026, 11, 20) }).balance, 15, 'an ISO asOf is read through the local day')
  assert.equal(accountBalance(A, data, { asOf: '2026-11-19' }).balance, 0)
})

test('records with no account, or an unknown account id, never touch any balance', () => {
  const A = acct('A', 100, '2026-11-01')
  const data = { expenses: [exp(noon(2026, 11, 5), 40, undefined), exp(noon(2026, 11, 5), 41, null), exp(noon(2026, 11, 5), 42, 'ghost'), exp(noon(2026, 11, 5), 1, 'A')] }
  assert.equal(accountBalance(A, data, { now: NOW }).balance, 99)
})

test('money is exact in cents', () => {
  const A = acct('A', 0, '2026-11-01')
  assert.equal(accountBalance(A, { income: [inc(noon(2026, 11, 2), 0.1, 'A'), inc(noon(2026, 11, 2), 0.2, 'A')] }, { now: NOW }).balance, 0.3)
  assert.equal(accountBalance(acct('B', 0.1, '2026-11-01'), { expenses: [exp(noon(2026, 11, 2), 0.3, 'B')] }, { now: NOW }).balance, -0.2)
})

test('a credit card can start and stay negative; a transfer to itself moves nothing', () => {
  const card = acct('C', -12000, '2026-11-01', { type: 'card' })
  const data = { expenses: [exp(noon(2026, 11, 3), 500, 'C')], transfers: [transfer(noon(2026, 11, 4), 2000, 'bank', 'C'), transfer(noon(2026, 11, 5), 999, 'C', 'C')] }
  assert.equal(accountBalance(card, data, { now: NOW }).balance, -12000 - 500 + 2000)
})

test('needs a valid opening date', () => {
  assert.throws(() => accountBalance({ id: 'x', openingBalance: 0 }, {}, { now: NOW }), RangeError)
  assert.throws(() => accountBalance(acct('x', 0, '2026-02-30'), {}, { now: NOW }), RangeError)
  assert.throws(() => accountBalance(acct('x', 0, '2026-11-01'), {}, { asOf: 'garbage' }), TypeError)
})

test('OLD (UTC-midnight) and NEW (local-noon) records land on the same day for the balance', { skip: pickerSafe ? false : 'old picker format shifts a day behind UTC (G17)' }, () => {
  const A = acct('A', 0, '2026-11-02')
  const data = { income: [inc(picked('2026-11-02'), 10, 'A'), inc(noon(2026, 11, 2), 5, 'A')] }
  const b = accountBalance(A, data, { asOf: '2026-11-02' })
  assert.deepEqual([b.balance, b.olderThanOpening], [15, 0])
})

// ---- ledger ----------------------------------------------------------------------------------------------------------

test('ledger: opening row first, signed effects, running balance, last running === balance', () => {
  const A = acct('A', 1000, '2026-11-01')
  const e1 = exp(at(2026, 11, 4, 9, 0), 200, 'A')
  const e2 = exp(at(2026, 11, 4, 18, 0), 30, 'A', { note: 'later same day' })
  const data = { expenses: [e2, e1, refund(noon(2026, 11, 5), 50, 'A')], income: [inc(noon(2026, 11, 3), 500, 'A')], transfers: [transfer(noon(2026, 11, 6), 100, 'A', 'B'), transfer(noon(2026, 11, 7), 40, 'B', 'A')], adjustments: [fix(noon(2026, 11, 8), 10, 'A')] }
  const rows = accountLedger(A, data, { now: NOW })
  assert.deepEqual(rows.map((r) => r.type), ['opening', 'income', 'expense', 'expense', 'refund', 'transfer-out', 'transfer-in', 'correction'])
  assert.deepEqual(rows.map((r) => r.amount), [1000, 500, -200, -30, 50, -100, 40, 10])
  assert.deepEqual(rows.map((r) => r.running), [1000, 1500, 1300, 1270, 1320, 1220, 1260, 1270])
  assert.equal(rows.at(-1).running, accountBalance(A, data, { now: NOW }).balance)
  assert.equal(rows[2].record.id, e1.id, 'same day: the one entered first comes first')
})

test('ledger: scheduled records are hidden unless asked for, and flagged', () => {
  const A = acct('A', 0, '2026-11-01')
  const data = { income: [inc(noon(2026, 11, 10), 10, 'A'), inc(noon(2026, 12, 25), 99, 'A')] }
  assert.equal(accountLedger(A, data, { now: NOW }).length, 2)
  const all = accountLedger(A, data, { now: NOW, includeScheduled: true })
  assert.deepEqual(all.map((r) => r.scheduled), [false, false, true])
  assert.equal(all.at(-1).running, 109)
})

// ---- overview / unassigned / reconciliation --------------------------------------------------------------------------

test('overview: totals add the signed balances of non-archived accounts (a card subtracts); byType splits them', () => {
  const store = {
    accounts: [acct('cash', 500, '2026-11-01', { type: 'cash' }), acct('bank', 2000, '2026-11-01'), acct('card', -300, '2026-11-01', { type: 'card' }), acct('old', 99, '2026-11-01', { archived: true })],
    transfers: [],
    adjustments: [],
  }
  const o = accountsOverview(store, {}, { now: NOW })
  assert.equal(o.total, 500 + 2000 - 300)
  assert.equal(o.totalIncludingArchived, 500 + 2000 - 300 + 99)
  assert.deepEqual([o.byType.cash, o.byType.bank, o.byType.card, o.byType.wallet], [500, 2000, -300, 0])
  assert.equal(o.balances.card.balance, -300)
  assert.deepEqual(accountsOverview(null, {}, { now: NOW }), { balances: {}, total: 0, totalIncludingArchived: 0, byType: { cash: 0, bank: 0, wallet: 0, card: 0, other: 0 } })
})

test('unassignedSince: records on/after the date with no account or an unknown one', () => {
  const store = { accounts: [acct('A', 0, '2026-11-01')] }
  const data = {
    expenses: [exp(noon(2026, 11, 5), 1, 'A'), exp(noon(2026, 11, 5), 2, undefined), exp(noon(2026, 11, 6), 3, 'ghost'), exp(noon(2026, 10, 1), 4, undefined), refund(noon(2026, 11, 7), 5, undefined)],
    income: [inc(noon(2026, 11, 8), 6, undefined), inc(noon(2026, 11, 8), 7, 'A')],
  }
  const u = unassignedSince(store, data, '2026-11-01')
  assert.deepEqual([u.expenses.length, u.income.length, u.count], [3, 1, 4])
  assert.equal(unassignedSince(store, data).count, 5, 'without a date: every unassigned record')
})

test('reconcile: exact difference; adding that correction makes the balance equal the real one', () => {
  const A = acct('A', 1000, '2026-11-01')
  const data = { expenses: [exp(noon(2026, 11, 4), 200.1, 'A')], income: [inc(noon(2026, 11, 3), 0.3, 'A')] }
  const r = reconcileDifference(A, data, { actual: 790, now: NOW })
  assert.deepEqual([r.expected, r.actual, r.difference, r.needsCorrection], [800.2, 790, -10.2, true])
  const withFix = { ...data, adjustments: [fix(noon(2026, 11, 20), r.difference, 'A')] }
  assert.equal(accountBalance(A, withFix, { now: NOW }).balance, 790)
  assert.equal(reconcileDifference(A, withFix, { actual: 790, now: NOW }).needsCorrection, false)
  assert.equal(reconcileDifference(A, data, { actual: '800.2', now: NOW }).difference, 0)
  for (const bad of ['', null, undefined, 'abc', NaN]) assert.throws(() => reconcileDifference(A, data, { actual: bad, now: NOW }), TypeError, String(bad))
})

// ---- validation + display -------------------------------------------------------------------------------------------

test('validateAccount', () => {
  const ok = { name: 'Cash', type: 'cash', openingBalance: 0, openingDate: '2026-11-01' }
  assert.deepEqual(validateAccount(ok), [])
  assert.ok(validateAccount({ ...ok, name: '  ' }).length)
  assert.ok(validateAccount({ ...ok, type: 'crypto' }).length)
  assert.ok(validateAccount({ ...ok, openingBalance: 'abc' }).length)
  assert.ok(validateAccount({ ...ok, openingBalance: '' }).length)
  assert.ok(validateAccount({ ...ok, openingDate: '11/01/2026' }).length)
  assert.deepEqual(validateAccount({ ...ok, openingBalance: -50 }), [], 'a negative opening balance is allowed')
  const existing = [{ id: 'x', name: 'cash' }]
  assert.match(validateAccount(ok, { accounts: existing }).join(), /already exists/)
  assert.deepEqual(validateAccount(ok, { accounts: existing, excludeId: 'x' }), [], 'renaming/editing itself is fine')
  assert.deepEqual(ACCOUNT_TYPES, ['cash', 'bank', 'wallet', 'card', 'other'])
})

test('validateTransfer / validateAdjustment', () => {
  const store = { accounts: [acct('A', 0, '2026-11-01'), acct('B', 0, '2026-11-01'), acct('Z', 0, '2026-11-01', { archived: true })] }
  const good = { fromAccountId: 'A', toAccountId: 'B', amount: 5, date: noon(2026, 11, 2) }
  assert.deepEqual(validateTransfer(store, good), [])
  assert.match(validateTransfer(store, { ...good, toAccountId: 'A' }).join(), /different/)
  assert.match(validateTransfer(store, { ...good, toAccountId: 'ghost' }).join(), /goes to/)
  assert.match(validateTransfer(store, { ...good, fromAccountId: undefined }).join(), /comes from/)
  assert.match(validateTransfer(store, { ...good, amount: 0 }).join(), /greater than 0/)
  assert.match(validateTransfer(store, { ...good, amount: -1 }).join(), /greater than 0/)
  assert.match(validateTransfer(store, { ...good, date: 'nope' }).join(), /valid date/)
  assert.match(validateTransfer(store, { ...good, toAccountId: 'Z' }).join(), /archived/)
  assert.deepEqual(validateTransfer(store, { ...good, toAccountId: 'Z' }, { requireActive: false }), [])
  assert.deepEqual(validateAdjustment(store, { accountId: 'A', amount: -3, date: noon(2026, 11, 2) }), [])
  assert.match(validateAdjustment(store, { accountId: 'A', amount: 0, date: noon(2026, 11, 2) }).join(), /non-zero/)
  assert.match(validateAdjustment(store, { accountId: 'ghost', amount: 1, date: noon(2026, 11, 2) }).join(), /account/)
})

test('balanceDisplay: a card shows "Owed", cash/bank negative is a gentle hint, never an error', () => {
  const card = { type: 'card' }
  const bank = { type: 'bank' }
  assert.deepEqual(balanceDisplay(card, -1200.5), { label: 'Owed', amount: 1200.5, signed: -1200.5, tone: 'neutral', hint: '' })
  assert.equal(balanceDisplay(card, 50).label, 'In credit')
  assert.equal(balanceDisplay(card, 0).label, 'Paid off')
  const neg = balanceDisplay(bank, -10)
  assert.deepEqual([neg.label, neg.amount, neg.tone], ['Balance', 10, 'warn'])
  assert.match(neg.hint, /missing records/)
  assert.deepEqual([balanceDisplay(bank, 10).tone, balanceDisplay(bank, 10).hint], ['neutral', ''])
})

// ---- the invariants (design K.4) ------------------------------------------------------------------------------------

function randomWorld(seed, { records = 260 } = {}) {
  const rand = mulberry32(seed)
  const ids = ['cash', 'bank', 'card']
  const accounts = [acct('cash', 500, '2026-03-01', { type: 'cash' }), acct('bank', 20000, '2026-04-15'), acct('card', -3000, '2026-05-06', { type: 'card' })]
  const pick = () => {
    const r = rand()
    return r < 0.62 ? ids[Math.floor(rand() * 3)] : r < 0.8 ? undefined : r < 0.9 ? null : 'ghost'
  }
  const date = () => {
    const day = new Date(2026, 1, 15 + Math.floor(rand() * 290), Math.floor(rand() * 24), Math.floor(rand() * 60))
    return rand() < 0.5 ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString() : day.toISOString()
  }
  const amount = () => Math.round(rand() * 400000) / 100 + 0.01
  const data = { expenses: [], income: [], transfers: [], adjustments: [] }
  for (let i = 0; i < records; i++) {
    const r = rand()
    if (r < 0.5) data.expenses.push(rand() < 0.12 ? refund(date(), amount() / 4, pick()) : exp(date(), amount(), pick()))
    else if (r < 0.68) data.income.push(inc(date(), amount() * 5, pick()))
    else if (r < 0.88) {
      const from = ids[Math.floor(rand() * 3)]
      let to = ids[Math.floor(rand() * 3)]
      if (to === from) to = ids[(ids.indexOf(from) + 1) % 3]
      data.transfers.push(transfer(date(), amount(), from, to))
    } else data.adjustments.push(fix(date(), (rand() < 0.5 ? -1 : 1) * amount() / 10, ids[Math.floor(rand() * 3)]))
  }
  return { store: { accounts, transfers: data.transfers, adjustments: data.adjustments }, data: { expenses: data.expenses, income: data.income } }
}

const totalOf = (world, extraTransfers = [], asOf) =>
  accountsOverview({ ...world.store, transfers: [...world.store.transfers, ...extraTransfers] }, world.data, { asOf, now: NOW }).total

test('I2: a transfer between accounts leaves the sum of all balances unchanged (every asOf day)', () => {
  for (const seed of [1, 2, 3]) {
    const world = randomWorld(seed)
    for (const asOf of ['2026-03-10', '2026-06-30', '2026-09-15', '2026-11-20', '2027-01-01']) {
      const before = totalOf(world, [], asOf)
      const after = totalOf(world, [transfer(noon(2026, 8, 1), 1234.56, 'cash', 'card'), transfer(noon(2026, 10, 1), 99.99, 'bank', 'cash')], asOf)
      // a transfer only moves money between accounts that exist at that time: it can differ when one end is not open yet
      const openAt = (id) => world.store.accounts.find((a) => a.id === id).openingDate <= asOf
      const bothOpen = ['cash', 'card', 'bank'].every(openAt)
      if (bothOpen && asOf >= '2026-10-01') assert.equal(cents(after), cents(before), `seed ${seed} asOf ${asOf}`)
    }
  }
})

test('I3: the sum of balances equals openings + assigned income/refunds - expenses (dated in range) + corrections, computed independently', () => {
  for (const seed of [4, 5, 6]) {
    const world = randomWorld(seed)
    const asOf = '2026-11-20'
    let expectedC = 0
    for (const a of world.store.accounts) {
      expectedC += cents(a.openingBalance)
      const inRange = (r) => {
        const d = localDayKey(r.date)
        return d !== null && d >= a.openingDate && d <= asOf
      }
      for (const e of world.data.expenses) if (e.accountId === a.id && inRange(e)) expectedC += (e.kind === 'refund' ? 1 : -1) * cents(e.amount)
      for (const i of world.data.income) if (i.accountId === a.id && inRange(i)) expectedC += cents(i.amount)
      for (const x of world.store.adjustments) if (x.accountId === a.id && inRange(x)) expectedC += cents(x.amount)
      for (const t of world.store.transfers) {
        if (!inRange(t)) continue
        if (t.toAccountId === a.id) expectedC += cents(t.amount)
        if (t.fromAccountId === a.id) expectedC -= cents(t.amount)
      }
    }
    assert.equal(cents(totalOf(world, [], asOf)), expectedC, `seed ${seed}`)
  }
})

test('I4: unassigned and orphaned records change no balance, whatever their amounts', () => {
  const world = randomWorld(7)
  const before = accountsOverview(world.store, world.data, { now: NOW })
  const mutated = {
    expenses: world.data.expenses.map((e) => (e.accountId && ['cash', 'bank', 'card'].includes(e.accountId) ? e : { ...e, amount: e.amount * 1000 + 17 })),
    income: world.data.income.map((i) => (i.accountId && ['cash', 'bank', 'card'].includes(i.accountId) ? i : { ...i, amount: i.amount * 1000 + 17 })),
  }
  const after = accountsOverview(world.store, mutated, { now: NOW })
  assert.deepEqual(after, before)
})

test('every ledger ends at its account balance, on random data', () => {
  const world = randomWorld(8)
  for (const a of world.store.accounts) {
    const rows = accountLedger(a, { ...world.data, transfers: world.store.transfers, adjustments: world.store.adjustments }, { now: NOW })
    assert.equal(cents(rows.at(-1).running), cents(accountBalance(a, { ...world.data, transfers: world.store.transfers, adjustments: world.store.adjustments }, { now: NOW }).balance), a.id)
    assert.equal(rows[0].type, 'opening')
  }
})

test('a transfer is not a transaction: the day sums of expenses/income are identical with or without transfers and corrections', async () => {
  const { summarize, filterTransactions } = await import('../src/utils/reporting.js')
  const { computeBudget } = await import('../src/utils/budgetMath.js')
  const world = randomWorld(9)
  const plain = { expenses: world.data.expenses.map(({ accountId, ...rest }) => rest), income: world.data.income.map(({ accountId, ...rest }) => rest) }
  assert.deepEqual(summarize(filterTransactions(world.data.expenses, { period: 'all' }), { now: NOW }), summarize(filterTransactions(plain.expenses, { period: 'all' }), { now: NOW }))
  // every NUMBER the budget produces is identical; only the raw record list (which carries the accountId field itself) differs
  const budget = (e, i) => {
    const { cycleList, ...numbers } = computeBudget({ expenses: e, income: i, categories: [{ id: 'food' }], resetDay: 6, now: NOW })
    return { numbers, count: cycleList.length }
  }
  assert.deepEqual(budget(world.data.expenses, world.data.income), budget(plain.expenses, plain.income))
})

test('inputs are never mutated', () => {
  const world = randomWorld(10, { records: 60 })
  const frozen = deepFreeze({ store: world.store, data: world.data })
  const full = { ...frozen.data, transfers: frozen.store.transfers, adjustments: frozen.store.adjustments }
  accountBalance(frozen.store.accounts[0], full, { now: NOW })
  accountsOverview(frozen.store, frozen.data, { now: NOW })
  accountLedger(frozen.store.accounts[1], full, { now: NOW, includeScheduled: true })
  unassignedSince(frozen.store, frozen.data, '2026-03-01')
  reconcileDifference(frozen.store.accounts[2], full, { actual: 1, now: NOW })
})

test('addDays-based boundary: the day before the opening day is out, the opening day is in, for every day of a month', () => {
  const A = acct('A', 0, '2026-11-15')
  let day = '2026-11-01'
  while (day <= '2026-11-30') {
    const b = accountBalance(A, { income: [inc(noon(...day.split('-').map(Number)), 1, 'A')] }, { asOf: '2026-11-30' })
    assert.equal(b.balance, day >= '2026-11-15' ? 1 : 0, day)
    day = addDays(day, 1)
  }
})

test('accounts.js stays pure: imports only reporting.js, no browser globals', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/utils/accounts.js', import.meta.url)), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  assert.deepEqual([...code.matchAll(/^\s*import[^\n]*from\s+'([^']+)'/gm)].map((m) => m[1]), ['./reporting.js'])
  assert.doesNotMatch(code, /localStorage|document|window|\.date\b[^\n;]*\.slice\(/)
})
