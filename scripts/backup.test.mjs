// Tests for src/utils/backup.js and the storage hardening in src/utils/storage.js.
// Run with: npm test   (no extra dependencies; uses node:test and an in-memory localStorage stub)
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ---- in-memory localStorage stub (must exist before the modules are imported) ----
let store = new Map()
let failWritesFor = null // key suffix that should throw like a full quota
globalThis.localStorage = {
  get length() {
    return store.size
  },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (failWritesFor && k.endsWith(failWritesFor)) throw new Error('QuotaExceededError')
    store.set(k, String(v))
  },
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
}

const { get, set, getRaw, STORAGE_KEYS } = await import('../app/utils/storage.js')
const { buildBackup, parseBackup, summarizeBackup, applyBackup, BACKUP_MODULES, BACKUP_KIND } = await import('../app/utils/backup.js')

// A realistic dataset touching every module.
function seed() {
  set(STORAGE_KEYS.SETTINGS, { profileName: 'Test', cycleResetDay: 6, overallBudget: 50000, categoryBudgets: { 'cat-food': 100 } })
  set(STORAGE_KEYS.CATEGORIES, [{ id: 'cat-food', name: 'Food', icon: '🍔', color: '#5FAE86', order: 0 }])
  set(STORAGE_KEYS.EXPENSES, [
    { id: 'e1', date: '2026-11-02T00:00:00.000Z', amount: 1200.5, categoryId: 'cat-food', note: 'lunch, "quoted"', source: 'manual', recurringId: null, billId: null, createdAt: '2026-11-02T08:00:00.000Z' },
    { id: 'e2', date: '2026-11-03T00:00:00.000Z', amount: 300, categoryId: 'cat-food', note: '', source: 'bill', recurringId: null, billId: 'b1', createdAt: '2026-11-03T08:00:00.000Z' },
  ])
  set(STORAGE_KEYS.INCOME, [{ id: 'i1', date: '2026-11-01T00:00:00.000Z', amount: 90000, sourceType: 'salary', note: '', createdAt: '2026-11-01T08:00:00.000Z' }])
  set(STORAGE_KEYS.RECURRING, [{ id: 'r1', name: 'Gym', amount: 5000, dueDay: 5, categoryId: 'cat-food' }])
  set(STORAGE_KEYS.BILLS, { connections: [{ id: 'c1', connectionName: 'Home' }], bills: [{ id: 'b1', amount: 300, status: 'paid', attachments: [] }] })
  set(STORAGE_KEYS.METER_READINGS, [{ id: 'm1', connectionId: 'c1', reading: 1000 }])
  set(STORAGE_KEYS.ASSETS, [{ id: 'a1', name: 'Laptop', currentValue: 150000 }])
  set(STORAGE_KEYS.LENDING, [{ id: 'l1', direction: 'lent', amount: 10000, repayments: [] }])
  set(STORAGE_KEYS.INVESTMENTS, [
    {
      id: 'f1',
      name: 'Fund',
      contributions: [{ id: 'c1', date: '2026-11-06T00:00:00.000Z', amount: 70000, createdAt: '2026-11-06T09:00:00.000Z' }],
      valueEntries: [{ id: 'v1', date: '2026-11-06T00:00:00.000Z', value: 386000, createdAt: '2026-11-06T09:30:00.000Z' }],
    },
  ])
  set(STORAGE_KEYS.VEHICLES, [{ id: 'veh1', name: 'Car' }])
  set(STORAGE_KEYS.VEHICLE_LOGS, [{ id: 'vl1', vehicleId: 'veh1' }])
  set(STORAGE_KEYS.FUEL_LOGS, [{ id: 'fl1', vehicleId: 'veh1', cost: 9000 }])
  set(STORAGE_KEYS.VEHICLE_TAGS, [{ id: 'tag-maintenance', name: 'Maintenance' }])
  set(STORAGE_KEYS.VAULT, { salt: 'abc', iv: 'def', ciphertext: 'ghi' })
  set(STORAGE_KEYS.APPLOCK, { passwordHash: 'HASH', salt: 'SALT' })
  set(STORAGE_KEYS.META, { version: 1 })
}

function snapshotOfModules() {
  return Object.fromEntries(BACKUP_MODULES.map((m) => [m.key, get(m.key, null)]))
}

beforeEach(() => {
  store = new Map()
  failWritesFor = null
})

test('round trip: export -> wipe -> import restores every module exactly', async () => {
  seed()
  const before = snapshotOfModules()

  const backup = await buildBackup()
  const text = JSON.stringify(backup)

  store = new Map() // simulate a brand-new device
  const parsed = parseBackup(text)
  assert.equal(parsed.ok, true, parsed.errors.join('; '))
  assert.deepEqual(parsed.warnings, [])

  const report = await applyBackup(parsed.backup)
  assert.equal(report.replaced.length, BACKUP_MODULES.length)
  assert.deepEqual(snapshotOfModules(), before)
})

test('backup never contains the app-lock record', async () => {
  seed()
  const text = JSON.stringify(await buildBackup())
  assert.equal(text.includes('HASH'), false)
  assert.equal(text.includes('applock'), false)
})

test('backup carries a format version, schema version and counts', async () => {
  seed()
  const b = await buildBackup()
  assert.equal(b.kind, BACKUP_KIND)
  assert.equal(b.formatVersion, 1)
  assert.equal(b.schemaVersion, 1)
  assert.equal(b.counts.expenses, 2)
  assert.equal(b.counts.bills, 1)
})

test('restoring a null section removes that key (device matches the backup)', async () => {
  seed()
  const backup = await buildBackup()
  backup.data[STORAGE_KEYS.LENDING] = null
  const parsed = parseBackup(JSON.stringify(backup))
  assert.equal(parsed.ok, true)
  await applyBackup(parsed.backup)
  assert.equal(getRaw(STORAGE_KEYS.LENDING), null)
})

test('legacy main backup imports its modules and leaves everything else untouched', async () => {
  seed()
  const legacy = {
    kind: 'hisaab-main-backup',
    exportedAt: '2026-10-01T00:00:00.000Z',
    expenses: [{ id: 'old', date: '2026-10-01T00:00:00.000Z', amount: 5, categoryId: 'cat-food' }],
    investments: [],
  }
  const parsed = parseBackup(JSON.stringify(legacy))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.backup.legacy, true)
  assert.ok(parsed.warnings.some((w) => w.includes('older-style')))

  const assetsBefore = getRaw(STORAGE_KEYS.ASSETS)
  const vaultBefore = getRaw(STORAGE_KEYS.VAULT)
  await applyBackup(parsed.backup)

  assert.deepEqual(get(STORAGE_KEYS.EXPENSES, null), legacy.expenses)
  assert.deepEqual(get(STORAGE_KEYS.INVESTMENTS, null), [])
  assert.equal(getRaw(STORAGE_KEYS.ASSETS), assetsBefore)
  assert.equal(getRaw(STORAGE_KEYS.VAULT), vaultBefore)
})

test('legacy vault+assets backup imports vault and assets only', async () => {
  seed()
  const expensesBefore = getRaw(STORAGE_KEYS.EXPENSES)
  const legacy = { kind: 'hisaab-vault-assets-backup', vault: { salt: 'X', iv: 'Y', ciphertext: 'Z' }, assets: [{ id: 'a9', name: 'Bike' }] }
  const parsed = parseBackup(JSON.stringify(legacy))
  assert.equal(parsed.ok, true)
  await applyBackup(parsed.backup)
  assert.deepEqual(get(STORAGE_KEYS.ASSETS, null), legacy.assets)
  assert.deepEqual(get(STORAGE_KEYS.VAULT, null), legacy.vault)
  assert.equal(getRaw(STORAGE_KEYS.EXPENSES), expensesBefore)
})

test('rejects bad files with a clear error and never touches storage', async () => {
  seed()
  const snapshot = new Map(store)
  const cases = [
    ['not json', /not valid JSON/],
    ['[1,2,3]', /expected a JSON object/],
    [JSON.stringify({ hello: 'world' }), /unrecognised/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 99, data: {} }), /newer version of Hisaab/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1, schemaVersion: 50, data: {} }), /newer data version/],
    [JSON.stringify({ kind: BACKUP_KIND, app: 'other', formatVersion: 1, data: {} }), /another app/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1 }), /no "data" section/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1, data: {} }), /does not contain any data/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1, data: { expenses: { not: 'a list' } } }), /Expenses: expected a list/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1, data: { expenses: [1, 2] } }), /not records/],
    [JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1, data: { bills: { bills: 'x' } } }), /"bills" must be a list/],
  ]
  for (const [text, pattern] of cases) {
    const r = parseBackup(text)
    assert.equal(r.ok, false, `should reject: ${text.slice(0, 60)}`)
    assert.match(r.errors.join(' | '), pattern)
    assert.equal(r.backup, null)
  }
  assert.deepEqual(store, snapshot, 'parsing must not write anything')
})

test('odd entries are warnings, not errors, so your own data can always be restored', () => {
  const text = JSON.stringify({
    kind: BACKUP_KIND,
    formatVersion: 1,
    data: { expenses: [{ id: 'x', amount: '12', date: 'garbage' }, { id: 'x', amount: 5, date: '2026-01-01T00:00:00.000Z' }] },
    counts: { expenses: 3 },
  })
  const r = parseBackup(text)
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some((w) => w.includes('non-numeric amount')))
  assert.ok(r.warnings.some((w) => w.includes('share an id')))
  assert.ok(r.warnings.some((w) => w.includes('file says 3 entries but contains 2')))
})

test('preview rows compare incoming vs current counts', async () => {
  seed()
  const parsed = parseBackup(JSON.stringify({ kind: BACKUP_KIND, formatVersion: 1, data: { expenses: [{ id: 'n', amount: 1, date: '2026-01-01T00:00:00.000Z' }], bills: { bills: [], connections: [] } } }))
  const rows = Object.fromEntries(summarizeBackup(parsed.backup).map((r) => [r.key, r]))
  assert.equal(rows.expenses.incoming, '1')
  assert.equal(rows.expenses.current, '2')
  assert.equal(rows.bills.incoming, '0 bills, 0 connections')
  assert.equal(rows.bills.current, '1 bills, 1 connections')
  assert.equal(rows.income, undefined, 'sections not in the file are not listed')
})

test('a failed write rolls every section back to what it was', async () => {
  seed()
  const before = snapshotOfModules()
  const parsed = parseBackup(
    JSON.stringify({
      kind: BACKUP_KIND,
      formatVersion: 1,
      data: {
        settings: { profileName: 'NEW' },
        categories: [{ id: 'new' }],
        expenses: [{ id: 'new', amount: 1, date: '2026-01-01T00:00:00.000Z' }],
        investments: [{ id: 'new', contributions: [], valueEntries: [] }],
      },
    })
  )
  failWritesFor = 'investments' // settings, categories, expenses... are already written when this one blows up like a full quota
  await assert.rejects(() => applyBackup(parsed.backup), /Investments/)
  failWritesFor = null
  assert.deepEqual(snapshotOfModules(), before)
})

test('corrupt stored data is preserved before the fallback is used', () => {
  localStorage.setItem('hisaab:expenses', '{this is not json')
  const value = get(STORAGE_KEYS.EXPENSES, [])
  assert.deepEqual(value, [])
  assert.equal(localStorage.getItem('hisaab:corrupt:expenses'), '{this is not json')

  // a later overwrite of the live key must not destroy the preserved copy
  set(STORAGE_KEYS.EXPENSES, [])
  get('expenses', [])
  assert.equal(localStorage.getItem('hisaab:corrupt:expenses'), '{this is not json')
})

test('set() reports failure instead of swallowing it', () => {
  failWritesFor = 'expenses'
  assert.equal(set(STORAGE_KEYS.EXPENSES, [1]), false)
  failWritesFor = null
  assert.equal(set(STORAGE_KEYS.EXPENSES, [1]), true)
})
