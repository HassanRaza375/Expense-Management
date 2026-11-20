// Phase 4: investment performance (src/utils/investments.js) and the useInvestments composable built on it.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

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

const { performance, valueAt, fundSeries, portfolioPerformance } = await import('../app/utils/investments.js')
const { useInvestments } = await import('../app/composables/useInvestments.js')

const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
let seq = 0
const rec = (date, extra) => ({ id: `r${++seq}`, date, createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), notes: '', ...extra })
const c = (date, amount, extra) => rec(date, { amount, ...extra })
const v = (date, value) => rec(date, { value })
const w = (date, amount, extra) => rec(date, { amount, ...extra })
const fund = (contributions = [], valueEntries = [], withdrawals) => ({ id: `f${++seq}`, name: 'Fund', contributions, valueEntries, ...(withdrawals ? { withdrawals } : {}) })
const approx = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} expected ${b}, got ${a}`)

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- a fund WITHOUT withdrawals behaves exactly as before ---------------------------------------------------------------

test('no withdrawals: current value, profit and return % equal the previous formulas, for many random funds', () => {
  const rnd = mulberry32(7)
  for (let i = 0; i < 300; i++) {
    const contributions = Array.from({ length: Math.floor(rnd() * 5) }, () => c(noon(2026, 1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 27)), Math.round(rnd() * 100000) / 100))
    const valueEntries = Array.from({ length: Math.floor(rnd() * 4) }, () => v(noon(2026, 1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 27)), Math.round(rnd() * 300000) / 100))
    const f = fund(contributions, valueEntries)
    const invested = contributions.reduce((s, x) => s + x.amount, 0)
    const latest = [...valueEntries].sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt))[0]
    const oldValue = latest ? latest.value : invested
    const p = performance(f)
    approx(p.currentValue, oldValue, 'value')
    approx(p.totalGain, oldValue - invested, 'profit')
    assert.equal(p.realizedGain, 0)
    approx(p.unrealizedGain, oldValue - invested, 'unrealized')
    if (invested > 0) approx(p.returnPct, ((oldValue - invested) / invested) * 100, 'pct')
    else assert.equal(p.returnPct, null)
  }
})

// ---- realized / unrealized --------------------------------------------------------------------------------------------

test('partial withdrawal: average cost realizes the right share of the gain', () => {
  // put in 1000, worth 1500, take out 750 (half of the holding): sold half the cost (500) for 750 -> realized 250
  const f = fund([c(noon(2026, 3, 1), 1000)], [v(noon(2026, 4, 1), 1500)], [w(noon(2026, 4, 2), 750)])
  const p = performance(f)
  assert.equal(p.invested, 1000)
  assert.equal(p.withdrawn, 750)
  assert.equal(p.netInvested, 250)
  assert.equal(p.currentValue, 750)
  assert.equal(p.costBasis, 500)
  assert.equal(p.realizedGain, 250)
  assert.equal(p.unrealizedGain, 250)
  assert.equal(p.totalGain, 500)
  assert.equal(p.returnPct, 50)
})

test('withdrawing everything realizes the whole gain and leaves nothing unrealized', () => {
  const f = fund([c(noon(2026, 3, 1), 1000)], [v(noon(2026, 4, 1), 1400)], [w(noon(2026, 4, 2), 1400)])
  const p = performance(f)
  assert.equal(p.currentValue, 0)
  assert.equal(p.realizedGain, 400)
  assert.equal(p.unrealizedGain, 0)
  assert.equal(p.costBasis, 0)
  assert.equal(p.totalGain, 400)
})

test('withdrawing at a LOSS realizes a negative gain', () => {
  const f = fund([c(noon(2026, 3, 1), 1000)], [v(noon(2026, 4, 1), 800)], [w(noon(2026, 4, 2), 400)])
  const p = performance(f)
  assert.equal(p.realizedGain, -100) // sold half (cost 500) for 400
  assert.equal(p.unrealizedGain, -100) // remaining 400 against cost 500
  assert.equal(p.totalGain, -200)
})

test('a value update after the withdrawal replaces the estimate; later contributions add to cost (profit dips until the next update, as before)', () => {
  const f = fund([c(noon(2026, 3, 1), 1000), c(noon(2026, 5, 1), 500)], [v(noon(2026, 4, 1), 1500), v(noon(2026, 6, 1), 1200)], [w(noon(2026, 4, 2), 750)])
  const p = performance(f)
  assert.equal(p.currentValue, 1200, 'the newest value entry wins')
  assert.equal(p.costBasis, 1000, '500 left after the sale + the 500 top-up')
  assert.equal(p.realizedGain, 250)
  assert.equal(p.unrealizedGain, 200)
  const noUpdate = fund([c(noon(2026, 3, 1), 1000), c(noon(2026, 5, 1), 500)], [v(noon(2026, 4, 1), 1500)], [w(noon(2026, 4, 2), 750)])
  assert.equal(performance(noUpdate).currentValue, 750, 'a top-up after the last value entry is not added to the value (documented choice)')
})

test('a withdrawal made AFTER the latest value entry is taken off the value (the money left the fund)', () => {
  const f = fund([c(noon(2026, 3, 1), 1000)], [v(noon(2026, 4, 1), 1500)], [w(noon(2026, 5, 1), 300)])
  assert.equal(performance(f).currentValue, 1200)
})

test('no value entry at all: value = contributions - withdrawals, so a plain withdrawal realizes nothing', () => {
  const f = fund([c(noon(2026, 3, 1), 1000)], [], [w(noon(2026, 3, 5), 400)])
  const p = performance(f)
  assert.equal(p.currentValue, 600)
  assert.equal(p.realizedGain, 0)
  assert.equal(p.unrealizedGain, 0)
})

test('IDENTITY (property): total gain = current value + withdrawn - contributed, for random funds with withdrawals', () => {
  const rnd = mulberry32(11)
  for (let i = 0; i < 400; i++) {
    const contributions = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => c(noon(2026, 1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 27)), 1 + Math.round(rnd() * 50000) / 100))
    const valueEntries = Array.from({ length: Math.floor(rnd() * 4) }, () => v(noon(2026, 1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 27)), Math.round(rnd() * 90000) / 100))
    const withdrawals = Array.from({ length: Math.floor(rnd() * 4) }, () => w(noon(2026, 1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 27)), 1 + Math.round(rnd() * 30000) / 100))
    const f = fund(contributions, valueEntries, withdrawals)
    const p = performance(f)
    const cents = (x) => Math.round(x * 100)
    // each piece is rounded to cents, so allow one cent per withdrawal of rounding drift
    assert.ok(Math.abs(cents(p.totalGain) - cents(p.currentValue + p.withdrawn - p.invested)) <= withdrawals.length, `identity broke on fund ${i}`)
    assert.ok(p.costBasis >= -0.005 * (withdrawals.length + 1), 'cost basis never goes materially negative')
    assert.ok(p.currentValue >= 0)
  }
})

// ---- ordering, edge cases -----------------------------------------------------------------------------------------------

test('same-day entries follow the order they were entered (contribution logged BEFORE the value update is not profit)', () => {
  const day = noon(2026, 4, 1)
  const f = fund([c(day, 1000)], [v(noon(2026, 3, 1), 1000), v(day, 2000)])
  const p = performance(f)
  assert.equal(p.currentValue, 2000)
  // the contribution (id r..., created earlier than the value entry) is in the cost: invested 1000 -> total gain 1000
  assert.equal(p.totalGain, 1000)
})

test('garbage never throws: missing arrays, unreadable dates, odd amounts', () => {
  assert.doesNotThrow(() => performance({}))
  assert.doesNotThrow(() => performance(null))
  assert.doesNotThrow(() => performance({ contributions: 'x', valueEntries: [null, {}], withdrawals: [{ amount: 'abc', date: 'nope' }] }))
  assert.equal(performance({}).currentValue, 0)
  assert.equal(performance({}).returnPct, null)
  assert.throws(() => performance(fund(), { asOf: '2026-13-45' }), RangeError)
})

test('valueAt / fundSeries: the fund value through time, using local days', () => {
  const f = fund([c(noon(2026, 3, 1), 1000), c(noon(2026, 5, 10), 500)], [v(noon(2026, 4, 1), 1300), v(noon(2026, 6, 1), 1900)], [w(noon(2026, 5, 20), 200)])
  assert.equal(valueAt(f, '2026-02-01'), 0)
  assert.equal(valueAt(f, '2026-03-15'), 1000, 'no value entry yet: value = contributions')
  assert.equal(valueAt(f, '2026-04-01'), 1300)
  assert.equal(valueAt(f, '2026-05-25'), 1100, 'withdrawal after the entry comes off')
  assert.equal(valueAt(f, '2026-06-01'), 1900)
  const s = fundSeries(f)
  assert.deepEqual(s.map((p) => p.dayKey), ['2026-03-01', '2026-04-01', '2026-05-10', '2026-05-20', '2026-06-01'])
  assert.equal(s.at(-1).value, 1900)
  assert.equal(s.at(-1).netInvested, 1300)
  assert.deepEqual(fundSeries(fund()), [])
})

test('portfolioPerformance sums funds; return % comes from the totals', () => {
  const a = fund([c(noon(2026, 3, 1), 1000)], [v(noon(2026, 4, 1), 1200)])
  const b = fund([c(noon(2026, 3, 1), 1000)], [v(noon(2026, 4, 1), 800)])
  const t = portfolioPerformance([a, b])
  assert.equal(t.invested, 2000)
  assert.equal(t.currentValue, 2000)
  assert.equal(t.totalGain, 0)
  assert.equal(t.returnPct, 0)
  assert.equal(portfolioPerformance([]).returnPct, null)
})

// ---- the composable -----------------------------------------------------------------------------------------------------

const inv = useInvestments()
beforeEach(() => {
  inv.funds.splice(0, inv.funds.length)
})

test('composable: a fund with no withdrawals shows the same numbers as before; new funds do not get a withdrawals field', () => {
  const f = inv.addFund({ name: 'A' })
  assert.equal('withdrawals' in f, false)
  inv.addContribution(f.id, { date: noon(2026, 3, 1), amount: 1000 })
  inv.addValueEntry(f.id, { date: noon(2026, 4, 1), value: 1100 })
  const live = inv.findById(f.id)
  assert.equal(inv.totalInvested(live), 1000)
  assert.equal(inv.currentValue(live), 1100)
  assert.equal(inv.profitLoss(live), 100)
  assert.equal(inv.profitLossPercent(live), 10)
  assert.equal(inv.portfolioProfitLoss(), 100)
})

test('composable: D1 regression - a same-day top-up is not profit; a different-day one is backed out as well', () => {
  const f = inv.addFund({ name: 'A' })
  inv.addValueEntry(f.id, { date: noon(2026, 3, 1), value: 10000 })
  inv.addContribution(f.id, { date: noon(2026, 4, 1), amount: 5000 })
  inv.addValueEntry(f.id, { date: noon(2026, 4, 1), value: 15000 })
  assert.equal(inv.changeSinceLast(inv.findById(f.id)), 0)
  const g = inv.addFund({ name: 'B' })
  inv.addValueEntry(g.id, { date: noon(2026, 3, 1), value: 10000 })
  inv.addContribution(g.id, { date: noon(2026, 3, 15), amount: 5000 })
  inv.addValueEntry(g.id, { date: noon(2026, 4, 1), value: 25000 })
  assert.equal(inv.changeSinceLast(inv.findById(g.id)), 10000)
})

test('composable: a withdrawal is not a loss in "change since last"', () => {
  const f = inv.addFund({ name: 'A' })
  inv.addContribution(f.id, { date: noon(2026, 3, 1), amount: 10000 })
  inv.addValueEntry(f.id, { date: noon(2026, 3, 2), value: 10000 })
  inv.addWithdrawal(f.id, { date: noon(2026, 3, 10), amount: 4000 })
  inv.addValueEntry(f.id, { date: noon(2026, 4, 1), value: 6500 })
  assert.equal(inv.changeSinceLast(inv.findById(f.id)), 500, '6500 - 10000 + 4000 withdrawn')
})

test('composable: withdrawals create the optional list lazily, carry an optional account, and cannot exceed the value', () => {
  const f = inv.addFund({ name: 'A' })
  inv.addContribution(f.id, { date: noon(2026, 3, 1), amount: 1000, accountId: 'bank' })
  inv.addValueEntry(f.id, { date: noon(2026, 4, 1), value: 1200 })
  const w1 = inv.addWithdrawal(f.id, { date: noon(2026, 4, 2), amount: 500, accountId: 'bank' })
  assert.equal(w1.accountId, 'bank')
  assert.equal(inv.findById(f.id).contributions[0].accountId, 'bank')
  const w2 = inv.addWithdrawal(f.id, { date: noon(2026, 4, 3), amount: 100 })
  assert.equal('accountId' in w2, false)
  assert.throws(() => inv.addWithdrawal(f.id, { date: noon(2026, 4, 4), amount: 5000 }), /more than the fund is worth/)
  assert.throws(() => inv.addWithdrawal(f.id, { amount: 0 }), /greater than 0/)
  assert.throws(() => inv.addWithdrawal('nope', { amount: 1 }), /not found/)
  assert.equal(inv.sortedWithdrawals(inv.findById(f.id)).length, 2)
  inv.deleteWithdrawal(f.id, w1.id)
  assert.equal(inv.findById(f.id).withdrawals.length, 1)
})
