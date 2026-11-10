// Tests for the Phase 1.2 changes to src/composables/useExpenses.js and useSettings.js
// (refund kind, bulk delete + restore, optional settings.lastCategoryId).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// minimal localStorage before the composables are imported
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
const { useSettings } = await import('../src/composables/useSettings.js')

const api = useExpenses()
const base = { date: '2026-11-02T07:00:00.000Z', amount: 100, categoryId: 'cat-food', note: 'x' }

beforeEach(() => {
  api.expenses.splice(0, api.expenses.length)
})

test('an ordinary expense has exactly the same stored shape as before (no kind field)', () => {
  const e = api.addExpense(base)
  assert.equal('kind' in e, false)
  assert.deepEqual(Object.keys(e).sort(), ['amount', 'billId', 'categoryId', 'createdAt', 'date', 'id', 'note', 'recurringId', 'source'])
  assert.equal(api.addExpense({ ...base, kind: 'expense' }).kind, undefined, 'kind "expense" is not stored')
})

test('a refund stores kind:"refund" with a POSITIVE amount', () => {
  const r = api.addExpense({ ...base, amount: 40, kind: 'refund' })
  assert.equal(r.kind, 'refund')
  assert.equal(r.amount, 40)
  assert.throws(() => api.addExpense({ ...base, amount: -40, kind: 'refund' }), /greater than 0/)
  assert.throws(() => api.addExpense({ ...base, amount: 0, kind: 'refund' }), /greater than 0/)
  assert.throws(() => api.addExpense({ ...base, kind: 'gift' }), /Kind must be/)
})

test('editing can switch an expense to a refund and back, and amount stays positive', () => {
  const e = api.addExpense(base)
  api.updateExpense(e.id, { kind: 'refund' })
  assert.equal(api.findById(e.id).kind, 'refund')
  api.updateExpense(e.id, { kind: 'expense' })
  assert.equal('kind' in api.findById(e.id), false, 'switching back removes the field')
  assert.throws(() => api.updateExpense(e.id, { kind: 'bogus' }), /Kind must be/)
  api.updateExpense(e.id, { note: 'only a note' })
  assert.equal(api.findById(e.id).note, 'only a note')
  assert.equal(api.findById(e.id).date, base.date, 'editing other fields never touches the date')
})

test('duplicating a refund yields a refund', () => {
  const r = api.addExpense({ ...base, kind: 'refund' })
  const copy = api.duplicateExpense(r.id)
  assert.equal(copy.kind, 'refund')
  assert.notEqual(copy.id, r.id)
})

test('deleteMany returns what it removed, in the original order, and restoreMany puts it back once', () => {
  const a = api.addExpense({ ...base, note: 'a' })
  const b = api.addExpense({ ...base, note: 'b' })
  const c = api.addExpense({ ...base, note: 'c' })
  const removed = api.deleteMany([a.id, c.id, 'does-not-exist'])
  assert.deepEqual(removed.map((e) => e.note), ['a', 'c'])
  assert.deepEqual(api.expenses.map((e) => e.note), ['b'])
  api.restoreMany(removed)
  assert.deepEqual(api.expenses.map((e) => e.note).sort(), ['a', 'b', 'c'])
  api.restoreMany(removed) // restoring twice must not duplicate
  assert.equal(api.expenses.length, 3)
  assert.deepEqual(api.deleteMany([]), [])
  api.restoreMany(null)
  assert.equal(api.expenses.length, 3)
  assert.ok(b)
})

test('settings: lastCategoryId is optional, defaults to empty, and can be set', () => {
  const { settings, setLastCategoryId } = useSettings()
  assert.equal(settings.lastCategoryId, '')
  setLastCategoryId('cat-gym')
  assert.equal(settings.lastCategoryId, 'cat-gym')
  setLastCategoryId(undefined)
  assert.equal(settings.lastCategoryId, '')
})

// ---- Phase 2.4: bulk assign account + Undo ---------------------------------------------------------------------------

test('applyAccountChanges sets / clears accountId, and undoAssignAccount restores exactly what was there', () => {
  const a = api.addExpense({ ...base, accountId: 'bank' })
  const b = api.addExpense(base)
  const c = api.addExpense({ ...base, accountId: 'cash' })
  const before = JSON.stringify(api.expenses)
  const applied = api.applyAccountChanges([
    { id: a.id, from: 'bank', to: 'wallet' },
    { id: b.id, from: '', to: 'wallet' },
    { id: c.id, from: 'cash', to: '' },
    { id: 'missing', from: '', to: 'wallet' },
  ])
  assert.equal(applied.length, 3, 'unknown ids are skipped')
  assert.equal(api.findById(a.id).accountId, 'wallet')
  assert.equal(api.findById(b.id).accountId, 'wallet')
  assert.equal('accountId' in api.findById(c.id), false, 'clearing removes the field instead of storing an empty string')
  api.undoAssignAccount(applied)
  assert.equal(JSON.stringify(api.expenses), before, 'Undo puts every record back byte-for-byte')
  assert.equal('accountId' in api.findById(b.id), false)
})

test('duplicating an expense keeps its account', () => {
  const a = api.addExpense({ ...base, accountId: 'bank' })
  const copy = api.duplicateExpense(a.id)
  assert.equal(copy.accountId, 'bank')
})
