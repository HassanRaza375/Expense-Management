// Session 6 tidy-ups: exact day counting for the cycle rail (across DST changes) and the Income page on the shared logic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { cycleDayProgress, cycleIncome, incomeOverview, computeBudget, toDateCycle } from '../app/utils/budgetMath.js'
import { localDayKey, cycleContaining, addDays, parseDayKey } from '../app/utils/reporting.js'
import { getCycle, getAdjacentCycle, isWithinCycle, daysElapsed as legacyDaysElapsed } from './legacy-cycle.mjs'

let seq = 0
const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).toISOString()
const NOW = (y, m, d, h = 12) => new Date(y, m - 1, d, h)
const inc = (date, amount, extra = {}) => ({ id: `i${++seq}`, date, amount, sourceType: 'salary', note: '', createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...extra })

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- cycle rail day count ------------------------------------------------------

test('cycleDayProgress: first, middle, last day, clamped outside the cycle, 28-day cycle', () => {
  const c = { startKey: '2026-11-06', endKey: '2026-12-05' }
  assert.deepEqual(cycleDayProgress(c, '2026-11-06'), { total: 30, elapsed: 1, left: 30 })
  assert.deepEqual(cycleDayProgress(c, '2026-11-20'), { total: 30, elapsed: 15, left: 16 })
  assert.deepEqual(cycleDayProgress(c, '2026-12-05'), { total: 30, elapsed: 30, left: 1 })
  assert.deepEqual(cycleDayProgress(c, '2026-11-01'), { total: 30, elapsed: 1, left: 30 }, 'before the cycle clamps to day 1')
  assert.deepEqual(cycleDayProgress(c, '2027-01-01'), { total: 30, elapsed: 30, left: 1 }, 'after the cycle clamps to the last day')
  assert.deepEqual(cycleDayProgress({ startKey: '2026-02-06', endKey: '2026-03-05' }, '2026-02-28'), { total: 28, elapsed: 23, left: 6 })
})

// Cycles that contain a DST change in at least one of the tested zones (US spring-forward 8 Mar and fall-back 1 Nov,
// EU 29 Mar, NZ 27 Sep). The day count must be exactly 1..N on every single day, at any time of day.
const DST_CYCLES = [
  { startKey: '2026-03-06', endKey: '2026-04-05' },
  { startKey: '2026-10-06', endKey: '2026-11-05' },
  { startKey: '2026-09-06', endKey: '2026-10-05' },
  { startKey: '2027-03-06', endKey: '2027-04-05' },
]

test('cycle rail day count is exact on EVERY day of cycles that cross a DST change, at any time of day', () => {
  for (const cycle of DST_CYCLES) {
    const total = cycleDayProgress(cycle, cycle.startKey).total
    let day = cycle.startKey
    let n = 0
    while (day <= cycle.endKey) {
      n++
      const { y, m, d } = parseDayKey(day)
      for (const [h, mi] of [[0, 30], [12, 0], [23, 30]]) {
        const today = localDayKey(new Date(y, m - 1, d, h, mi))
        assert.equal(today, day)
        assert.deepEqual(cycleDayProgress(cycle, today), { total, elapsed: n, left: total - n + 1 }, `${cycle.startKey} day ${n} at ${h}:${mi}`)
      }
      day = addDays(day, 1)
    }
    assert.equal(n, total)
  }
})

test('the rail gets the same count through its Date objects (toDateCycle round trip)', () => {
  for (const cycle of DST_CYCLES) {
    const dates = toDateCycle(cycle)
    assert.equal(localDayKey(dates.start), cycle.startKey)
    assert.equal(localDayKey(dates.end), cycle.endKey)
  }
})

test('the OLD millisecond-based day count was wrong across a spring-forward; the new one never is', () => {
  let legacyWrong = 0
  let newWrong = 0
  let springForward = false
  for (const cycle of DST_CYCLES) {
    const dates = toDateCycle(cycle)
    if (dates.end.getTimezoneOffset() < dates.start.getTimezoneOffset()) springForward = true // clocks moved forward inside this cycle
    let day = cycle.startKey
    let n = 0
    while (day <= cycle.endKey) {
      n++
      const { y, m, d } = parseDayKey(day)
      const today = new Date(y, m - 1, d, 12)
      if (legacyDaysElapsed({ start: dates.start, end: dates.end }, today) !== n) legacyWrong++
      if (cycleDayProgress(cycle, localDayKey(today)).elapsed !== n) newWrong++
      day = addDays(day, 1)
    }
  }
  assert.equal(newWrong, 0)
  if (springForward) assert.ok(legacyWrong > 0, 'in a zone that springs forward, the legacy count is off on some days')
  else assert.equal(legacyWrong, 0, 'without a spring-forward the legacy count happened to be right')
})

// ---- Income page --------------------------------------------------------------

function incomeData() {
  const rand = mulberry32(17)
  const list = []
  for (let i = 0; i < 160; i++) {
    list.push(inc(new Date(2026, 0, 1 + Math.floor(rand() * 330), 12).toISOString(), Math.round(rand() * 9000000) / 100 + 100))
  }
  return list
}

test('income overview matches the ORIGINAL Income page filter for reset days 1-28 (this / last / all)', () => {
  const income = incomeData()
  let compared = 0
  for (let resetDay = 1; resetDay <= 28; resetDay++) {
    for (const ref of [NOW(2026, 3, 9), NOW(2026, 6, 20), NOW(2026, 8, 5), NOW(2026, 11, 30)]) {
      const cycle = getCycle(ref, resetDay)
      const last = getAdjacentCycle(cycle.start, resetDay, -1)
      const expected = {
        this: income.filter((i) => isWithinCycle(i.date, cycle)),
        last: income.filter((i) => isWithinCycle(i.date, last)),
        all: income,
      }
      for (const mode of ['this', 'last', 'all']) {
        const o = incomeOverview(income, { mode, now: ref, resetDay })
        assert.deepEqual(o.list.map((i) => i.id).sort(), expected[mode].map((i) => i.id).sort(), `${mode} r=${resetDay} ${localDayKey(ref)}`)
        const oldTotal = expected[mode].reduce((s, i) => s + Math.round(i.amount * 100), 0)
        assert.equal(Math.round(o.total * 100), oldTotal, `${mode} total`)
        assert.equal(o.count, expected[mode].length)
        compared++
      }
    }
  }
  assert.ok(compared >= 300)
})

test('Income page total === Dashboard "Income this cycle", for every reset day 1-31', () => {
  const income = incomeData()
  for (let resetDay = 1; resetDay <= 31; resetDay++) {
    for (const now of [NOW(2026, 2, 28), NOW(2026, 5, 31), NOW(2026, 9, 30), NOW(2026, 12, 31)]) {
      const page = incomeOverview(income, { mode: 'this', now, resetDay })
      const dash = computeBudget({ income, categories: [], resetDay, now })
      assert.equal(page.total, dash.cycleIncome, `r=${resetDay} ${localDayKey(now)}`)
      assert.equal(cycleIncome(income, cycleContaining(localDayKey(now), resetDay)), page.total)
    }
  }
})

test('income overview groups by LOCAL day with a total per day, and nothing is lost', () => {
  const list = [inc(at(2026, 11, 9, 0, 20), 100), inc(at(2026, 11, 8, 23, 50), 40), inc(noon(2026, 11, 9), 5.5), inc('nope', 7)]
  const o = incomeOverview(list, { mode: 'all', now: NOW(2026, 11, 15), resetDay: 6 })
  assert.deepEqual(o.groups.map((g) => [g.dayKey, g.net]), [['2026-11-09', 105.5], ['2026-11-08', 40], [null, 7]])
  assert.equal(o.total, 152.5)
  assert.equal(o.total, o.groups.reduce((s, g) => s + g.net, 0))
  assert.deepEqual(incomeOverview([], { mode: 'this', now: NOW(2026, 11, 15), resetDay: 6 }).groups, [])
})

test('cycleIncome: only income dated inside the cycle, both end days included', () => {
  const cycle = { startKey: '2026-11-06', endKey: '2026-12-05' }
  const list = [inc(at(2026, 11, 6, 0, 0), 10), inc(at(2026, 12, 5, 23, 59), 20), inc(at(2026, 11, 5, 23, 59), 99), inc(at(2026, 12, 6, 0, 1), 99)]
  assert.equal(cycleIncome(list, cycle), 30)
  assert.equal(cycleIncome([], cycle), 0)
})

test('the Income page and the cycle rail contain no date math of their own', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  for (const f of ['../app/views/IncomeView.vue', '../app/components/CycleRail.vue', '../app/composables/useIncome.js']) {
    const src = read(f)
    assert.doesNotMatch(src, /getCycle|getAdjacentCycle|isWithinCycle|daysInCycle|daysElapsed|\.slice\(0, 10\)|setMonth\(/, f)
  }
})
