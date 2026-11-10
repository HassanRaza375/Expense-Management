// Phase 5: savings goals (src/utils/goals.js) and the useGoals store.
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

const { validateGoal, manualSaved, goalProgress } = await import('../src/utils/goals.js')
const { parseBackup, BACKUP_MODULES } = await import('../src/utils/backup.js')
const { STORAGE_KEYS } = await import('../src/utils/storage.js')

const NOW = new Date(2026, 10, 20, 12) // 20 Nov 2026
const goal = (extra = {}) => ({ id: 'g', name: 'Emergency fund', targetAmount: 1000, targetDate: '2026-12-20', startDay: '2026-10-20', savings: [], ...extra })

test('validateGoal: plain-sentence problems, [] when fine', () => {
  assert.deepEqual(validateGoal(goal()), [])
  assert.deepEqual(validateGoal(goal({ targetDate: '' })), [])
  assert.match(validateGoal({}).join(), /name/)
  assert.match(validateGoal(goal({ targetAmount: 0 })).join(), /greater than 0/)
  assert.match(validateGoal(goal({ targetAmount: 'abc' })).join(), /greater than 0/)
  assert.match(validateGoal(goal({ targetDate: '2026-13-40' })).join(), /target date/)
  assert.match(validateGoal(goal({ targetDate: '2026-09-01' })).join(), /before the start/)
  assert.match(validateGoal(goal({ startDay: 'nope' })).join(), /start day/)
})

test('manualSaved: sums in cents, negative entries are taken-out money, never below zero', () => {
  assert.equal(manualSaved(goal({ savings: [{ amount: 0.1 }, { amount: 0.2 }] })), 0.3)
  assert.equal(manualSaved(goal({ savings: [{ amount: 100 }, { amount: -30 }] })), 70)
  assert.equal(manualSaved(goal({ savings: [{ amount: 10 }, { amount: -50 }] })), 0)
  assert.equal(manualSaved({}), 0)
  assert.doesNotThrow(() => manualSaved({ savings: [null, 'x', { amount: 'abc' }] }))
})

test('progress from manual savings: halfway through the time and halfway to the target is on track', () => {
  // 20 Oct -> 20 Dec is 61 days; 20 Nov is day 31 (about 50.8% of the time)
  const p = goalProgress(goal({ savings: [{ amount: 600 }] }), { now: NOW })
  assert.equal(p.source, 'manual')
  assert.equal(p.saved, 600)
  assert.equal(p.remaining, 400)
  assert.equal(p.pct, 60)
  assert.equal(p.status, 'on-track')
  assert.equal(p.daysLeft, 30)
  assert.equal(p.requiredPerMonth, 400, '30 days left = 1 month')
})

test('behind schedule when less is saved than the time that has passed', () => {
  const p = goalProgress(goal({ savings: [{ amount: 200 }] }), { now: NOW })
  assert.equal(p.status, 'behind')
  assert.ok(p.expectedPct > 50 && p.expectedPct < 51)
})

test('reached beats everything, including a passed date; overdue when the date passed and it is not reached', () => {
  assert.equal(goalProgress(goal({ savings: [{ amount: 1000 }], targetDate: '2026-01-01' }), { now: NOW }).status, 'reached')
  const over = goalProgress(goal({ savings: [{ amount: 10 }], targetDate: '2026-11-01' }), { now: NOW })
  assert.equal(over.status, 'overdue')
  assert.equal(over.requiredPerMonth, null)
  assert.equal(over.daysLeft, null)
})

test('no target date: no schedule maths, status no-date', () => {
  const p = goalProgress(goal({ targetDate: null, savings: [{ amount: 250 }] }), { now: NOW })
  assert.equal(p.status, 'no-date')
  assert.equal(p.daysLeft, null)
  assert.equal(p.requiredPerMonth, null)
  assert.equal(p.pct, 25)
})

test('a goal that follows an account uses that balance (floored at 0); a missing account falls back to manual savings and says so', () => {
  const linked = goal({ accountId: 'acc', savings: [{ amount: 5 }] })
  const p = goalProgress(linked, { accountBalance: 750, now: NOW })
  assert.deepEqual([p.source, p.saved, p.accountMissing], ['account', 750, false])
  assert.equal(goalProgress(linked, { accountBalance: -40, now: NOW }).saved, 0)
  const gone = goalProgress(linked, { accountBalance: null, now: NOW })
  assert.deepEqual([gone.source, gone.saved, gone.accountMissing], ['manual', 5, true])
  assert.equal(goalProgress(goal(), { accountBalance: 999, now: NOW }).source, 'manual', 'a goal with no account ignores any balance')
})

test('progress never exceeds 100% on the bar, but the real percentage and the reached flag are kept', () => {
  const p = goalProgress(goal({ savings: [{ amount: 2500 }] }), { now: NOW })
  assert.equal(p.pct, 100)
  assert.equal(p.pctRaw, 250)
  assert.equal(p.reached, true)
  assert.equal(p.remaining, 0)
})

test('start day defaults to the day the goal was created; the target date today is still on schedule', () => {
  const p = goalProgress({ id: 'x', name: 'x', targetAmount: 100, targetDate: '2026-11-20', createdAt: new Date(2026, 10, 1, 9).toISOString(), savings: [{ amount: 100 }] }, { now: NOW })
  assert.equal(p.status, 'reached')
  const q = goalProgress({ id: 'x', name: 'x', targetAmount: 100, targetDate: '2026-11-20', createdAt: new Date(2026, 10, 1, 9).toISOString(), savings: [{ amount: 50 }] }, { now: NOW })
  assert.equal(q.status, 'behind', 'on the target day with half saved is behind: expected 100%')
  assert.equal(q.daysLeft, 0)
})

test('odd goals never throw: missing fields, bad dates, zero target', () => {
  assert.doesNotThrow(() => goalProgress({}, { now: NOW }))
  assert.doesNotThrow(() => goalProgress({ targetAmount: 'x', targetDate: 'nope', startDay: 'nope', savings: 'x' }, { now: NOW }))
  assert.equal(goalProgress({}, { now: NOW }).pct, 0)
  assert.throws(() => goalProgress(goal(), { now: new Date('nope') }), TypeError)
})

// ---- the store and the backup ------------------------------------------------------------------------------------------

test('goals are a backup module with an id-unique array shape; bad goals only warn', () => {
  assert.ok(BACKUP_MODULES.some((m) => m.key === STORAGE_KEYS.GOALS && m.shape === 'array'))
  const file = (goals) => JSON.stringify({ kind: 'hisaab-full-backup', formatVersion: 1, schemaVersion: 3, data: { goals } })
  const ok = parseBackup(file([goal()]))
  assert.equal(ok.ok, true, ok.errors.join())
  assert.deepEqual(ok.warnings, [])
  const bad = parseBackup(file([goal({ targetAmount: 0 }), goal({ savings: 'x' })]))
  assert.equal(bad.ok, true, 'item-level problems are warnings, never blockers')
  assert.ok(bad.warnings.length >= 2)
  assert.equal(parseBackup(file({ not: 'a list' })).ok, false, 'a wrong-shaped section is refused')
})

const { useGoals } = await import('../src/composables/useGoals.js')
const g = useGoals()
beforeEach(() => {
  g.goals.splice(0, g.goals.length)
})

test('store: add / edit / delete with undo, manual savings, optional account stored only when given', () => {
  const a = g.addGoal({ name: ' Holiday ', targetAmount: '50000', targetDate: '2027-03-01' })
  assert.equal(a.name, 'Holiday')
  assert.equal(a.targetAmount, 50000)
  assert.equal('accountId' in a, false)
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(a.startDay))
  const b = g.addGoal({ name: 'Car', targetAmount: 10, accountId: 'acc1' })
  assert.equal(b.accountId, 'acc1')
  assert.throws(() => g.addGoal({ name: '', targetAmount: 5 }), /name/)
  assert.throws(() => g.addGoal({ name: 'x', targetAmount: 0 }), /greater than 0/)

  g.updateGoal(a.id, { name: 'Holiday 2027', targetAmount: 60000, accountId: 'acc2' })
  assert.deepEqual([g.findById(a.id).name, g.findById(a.id).targetAmount, g.findById(a.id).accountId], ['Holiday 2027', 60000, 'acc2'])
  g.updateGoal(a.id, { accountId: '' })
  assert.equal('accountId' in g.findById(a.id), false)
  assert.throws(() => g.updateGoal(a.id, { targetAmount: -1 }), /greater than 0/)

  g.addSaving(a.id, { date: '2026-11-02', amount: 1500, note: 'bonus' })
  g.addSaving(a.id, { amount: -200 })
  assert.equal(g.findById(a.id).savings.length, 2)
  assert.equal(manualSaved(g.findById(a.id)), 1300)
  assert.throws(() => g.addSaving(a.id, { amount: 0 }), /not be 0/)
  g.deleteSaving(a.id, g.findById(a.id).savings[1].id)
  assert.equal(manualSaved(g.findById(a.id)), 1500)

  g.deleteGoal(a.id)
  assert.equal(g.goals.length, 1)
  g.undoDelete()
  assert.equal(g.goals.length, 2)
})

test('store persists to storage under the goals key', async () => {
  const x = g.addGoal({ name: 'Persist', targetAmount: 5 })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(JSON.parse(localStorage.getItem('hisaab:goals')).some((goal) => goal.id === x.id))
})
