// Phase 2.0: the migration runner (pure, injected) and the real startup wiring (localStorage + safety snapshots).
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

const { runMigrations, MIGRATIONS, CURRENT_SCHEMA_VERSION } = await import('../app/utils/migrations.js')
const { prepareData } = await import('../app/utils/startup.js')
const { listSnapshots } = await import('../app/utils/snapshots.js')

// ---- the runner, with everything injected -------------------------------------------------------------------------

function harness({ version = null, data = false, snapshotFails = false, restoreFails = false } = {}) {
  const calls = []
  let v = version
  const h = {
    calls,
    get version() {
      return v
    },
    deps: {
      readVersion: () => v,
      writeVersion: (n) => {
        calls.push(`write:${n}`)
        v = n
      },
      hasData: () => data,
      snapshot: async (reason) => {
        calls.push(`snapshot:${reason}`)
        if (snapshotFails) throw new Error('IndexedDB is not available')
        return { id: 's1' }
      },
      restore: async () => {
        calls.push('restore')
        if (restoreFails) throw new Error('restore broke')
      },
    },
  }
  return h
}
const step = (from, to, extra = {}) => ({ from, to, name: `${from}->${to}`, rewrites: false, async up() {}, ...extra })

// The tests below inject their own chains and targets, so they keep passing when a future version is added.
const CUR = CURRENT_SCHEMA_VERSION

test('the shipped chain is 1 -> 2 -> 3, all additive (rewrites nothing), and ends at the current version', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 3)
  assert.deepEqual(MIGRATIONS.map((m) => [m.from, m.to, m.rewrites]), [[1, 2, false], [2, 3, false]])
  assert.equal(MIGRATIONS.at(-1).to, CURRENT_SCHEMA_VERSION)
})

test('fresh install (no meta, no data): stamped with the current version, no snapshot, nothing else', async () => {
  const h = harness({ version: null, data: false })
  const r = await runMigrations(h.deps)
  assert.equal(r.status, 'ok')
  assert.equal(r.fresh, true)
  assert.equal(h.version, CUR)
  assert.deepEqual(h.calls, [`write:${CUR}`])
})

test('existing user (no meta but stored data) counts as version 1: snapshot FIRST, steps, stamp LAST', async () => {
  const order = []
  const h = harness({ version: null, data: true })
  const r = await runMigrations({ ...h.deps, migrations: [step(1, 2, { async up() { order.push('up') } })], target: 2 })
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.applied, ['1->2'])
  assert.deepEqual(h.calls, ['snapshot:before-migration', 'write:2'])
  assert.deepEqual(order, ['up'])
  assert.equal(r.snapshotTaken, true)
  assert.equal(h.version, 2)
})

test('already current: nothing happens (no snapshot, no write)', async () => {
  const h = harness({ version: CUR, data: true })
  const r = await runMigrations(h.deps)
  assert.equal(r.status, 'up-to-date')
  assert.deepEqual(h.calls, [])
})

test('NEWER data than the app understands is never touched (downgrade protection)', async () => {
  const h = harness({ version: CUR + 1, data: true })
  const r = await runMigrations(h.deps)
  assert.deepEqual([r.status, r.from, r.to], ['too-new', CUR + 1, CUR])
  assert.deepEqual(h.calls, [], 'no snapshot, no write')
  assert.equal(h.version, CUR + 1)
})

test('multi-step chain runs in order, and running it again is a no-op (idempotent)', async () => {
  const ran = []
  const chain = [step(1, 2, { async up() { ran.push('a') } }), step(2, 3, { async up() { ran.push('b') } }), step(3, 4, { async up() { ran.push('c') } })]
  const h = harness({ version: 1, data: true })
  const first = await runMigrations({ ...h.deps, migrations: chain, target: 4 })
  assert.deepEqual([first.status, first.applied], ['ok', ['1->2', '2->3', '3->4']])
  assert.deepEqual(ran, ['a', 'b', 'c'])
  assert.equal(h.version, 4)
  const second = await runMigrations({ ...h.deps, migrations: chain, target: 4 })
  assert.equal(second.status, 'up-to-date')
  assert.deepEqual(ran, ['a', 'b', 'c'], 'nothing ran twice')
  assert.equal(h.calls.filter((c) => c.startsWith('snapshot')).length, 1)
})

test('a step that FAILS restores the snapshot and does NOT stamp the version', async () => {
  const h = harness({ version: 1, data: true })
  const r = await runMigrations({ ...h.deps, migrations: [step(1, 2, { rewrites: true, async up() { throw new Error('boom') } })], target: 2 })
  assert.deepEqual([r.status, r.reason, r.error, r.restored], ['failed', 'step-failed', 'boom', true])
  assert.deepEqual(h.calls, ['snapshot:before-migration', 'restore'])
  assert.equal(h.version, 1, 'the version was not stamped')
})

test('a failing stamp write also restores; a failing restore is reported, never hidden', async () => {
  const h = harness({ version: 1, data: true })
  h.deps.writeVersion = () => {
    throw new Error('quota')
  }
  const r = await runMigrations({ ...h.deps, migrations: [step(1, 2)], target: 2 })
  assert.deepEqual([r.status, r.restored], ['failed', true])

  const h2 = harness({ version: 1, data: true, restoreFails: true })
  const r2 = await runMigrations({ ...h2.deps, migrations: [step(1, 2, { async up() { throw new Error('boom') } })], target: 2 })
  assert.deepEqual([r2.status, r2.restored, r2.restoreError], ['failed', false, 'restore broke'])
})

test('no snapshot possible: an additive step may proceed, a rewriting step must not run at all', async () => {
  const ran = []
  const additive = harness({ version: 1, data: true, snapshotFails: true })
  const ok = await runMigrations({ ...additive.deps, migrations: [step(1, 2, { async up() { ran.push('additive') } })], target: 2 })
  assert.deepEqual([ok.status, ok.snapshotTaken, ran], ['ok', false, ['additive']])

  const rewriting = harness({ version: 1, data: true, snapshotFails: true })
  const blocked = await runMigrations({ ...rewriting.deps, migrations: [step(1, 2, { rewrites: true, async up() { ran.push('rewrite') } })], target: 2 })
  assert.deepEqual([blocked.status, blocked.reason], ['failed', 'no-snapshot'])
  assert.deepEqual(ran, ['additive'], 'the rewriting step never ran')
  assert.equal(rewriting.version, 1)
})

test('a gap in the chain is detected BEFORE anything runs', async () => {
  const ran = []
  const h = harness({ version: 1, data: true })
  const r = await runMigrations({ ...h.deps, migrations: [step(1, 2, { async up() { ran.push('x') } }), step(3, 4)], target: 4 })
  assert.deepEqual([r.status, r.reason], ['failed', 'missing-migration'])
  assert.deepEqual(ran, [])
  assert.deepEqual(h.calls, [], 'not even a snapshot')
})

test('an unreadable stored version blocks instead of guessing', async () => {
  for (const bad of ['x', 0, -1, 1.5, {}]) {
    const h = harness({ version: bad, data: true })
    const r = await runMigrations(h.deps)
    assert.deepEqual([r.status, r.reason], ['failed', 'unreadable-version'], String(bad))
    assert.deepEqual(h.calls, [])
  }
})

// ---- the real wiring ---------------------------------------------------------------------------------------------

beforeEach(() => {
  store.clear()
  installFakeIndexedDB()
})

const seedData = () => {
  localStorage.setItem('hisaab:expenses', JSON.stringify([{ id: 'e1', date: '2026-11-01T07:00:00.000Z', amount: 12.5, categoryId: 'cat-food' }]))
  localStorage.setItem('hisaab:income', JSON.stringify([{ id: 'i1', date: '2026-11-02T07:00:00.000Z', amount: 100 }]))
  localStorage.setItem('hisaab:applock', JSON.stringify({ passwordHash: 'SECRET', salt: 'S' }))
}

test('startup, fresh install: stamps the current version, takes no snapshot, does not block', async () => {
  const r = await prepareData()
  assert.deepEqual([r.blocked, r.fresh, r.status], [false, true, 'ok'])
  assert.deepEqual(JSON.parse(localStorage.getItem('hisaab:meta')), { version: CUR })
  assert.equal((await listSnapshots()).length, 0)
})

test('startup, existing version-1 data: snapshot taken, version stamped current (1 -> 2 -> 3), every record untouched byte-for-byte', async () => {
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 1 }))
  const before = Object.fromEntries([...store.entries()].filter(([k]) => k !== 'hisaab:meta'))

  const r = await prepareData()

  assert.deepEqual([r.blocked, r.status, r.snapshotTaken], [false, 'ok', true])
  assert.deepEqual(JSON.parse(localStorage.getItem('hisaab:meta')), { version: CUR })
  const after = Object.fromEntries([...store.entries()].filter(([k]) => k !== 'hisaab:meta'))
  assert.deepEqual(after, before, 'nothing but the version marker changed')
  const snaps = await listSnapshots()
  assert.equal(snaps.length, 1)
  assert.equal(snaps[0].reason, 'before-migration')
  assert.equal(snaps[0].backup.data.expenses.length, 1)
  assert.equal(JSON.stringify(snaps).includes('SECRET'), false, 'the app-lock record is not in the snapshot')
})

test('startup, data from before versioning existed (no meta): treated as version 1', async () => {
  seedData()
  const r = await prepareData()
  assert.deepEqual([r.status, r.from, r.blocked], ['ok', 1, false])
  assert.deepEqual(JSON.parse(localStorage.getItem('hisaab:meta')), { version: CUR })
  assert.equal((await listSnapshots()).length, 1)
})

test('startup, already the current version: nothing runs and no new snapshot', async () => {
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: CUR }))
  const r = await prepareData()
  assert.deepEqual([r.status, r.blocked], ['up-to-date', false])
  assert.equal((await listSnapshots()).length, 0)
})

test('startup, data from a NEWER app: blocked with a clear message, nothing written, no snapshot', async () => {
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: CUR + 1, extra: 'keep' }))
  const before = new Map(store)
  const r = await prepareData()
  assert.equal(r.blocked, true)
  assert.match(r.message, /newer version of Hisaab/)
  assert.match(r.message, /Nothing was changed/)
  assert.deepEqual(new Map(store), before, 'storage is byte-for-byte identical')
  assert.equal((await listSnapshots()).length, 0)
})

test('startup, a failing migration: the snapshot is restored for real, the version is not stamped, the app is blocked', async () => {
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 1 }))
  const originalExpenses = localStorage.getItem('hisaab:expenses')
  const bad = [
    {
      from: 1,
      to: 2,
      name: 'bad step',
      rewrites: true,
      async up() {
        localStorage.setItem('hisaab:expenses', JSON.stringify([{ id: 'ruined' }])) // damages data, then fails
        localStorage.setItem('hisaab:income', '[]')
        throw new Error('step exploded')
      },
    },
  ]
  const r = await prepareData({ migrations: bad, target: 2 })
  assert.deepEqual([r.blocked, r.status, r.restored], [true, 'failed', true])
  assert.match(r.message, /restored from the automatic safety snapshot/)
  assert.equal(localStorage.getItem('hisaab:expenses'), originalExpenses, 'expenses are back exactly as they were')
  assert.equal(JSON.parse(localStorage.getItem('hisaab:income')).length, 1)
  assert.deepEqual(JSON.parse(localStorage.getItem('hisaab:meta')), { version: 1 })
  assert.equal(localStorage.getItem('hisaab:applock').includes('SECRET'), true, 'the app-lock record was never touched')
})

test('startup, a rewriting migration is refused when no snapshot can be taken (IndexedDB unavailable)', async () => {
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 1 }))
  globalThis.indexedDB = undefined
  let ran = false
  const r = await prepareData({ migrations: [{ from: 1, to: 2, name: 'rewrite', rewrites: true, async up() { ran = true } }], target: 2 })
  assert.deepEqual([r.blocked, r.reason, ran], [true, 'no-snapshot', false])
  assert.match(r.message, /No data was changed/)
})

test('startup keeps other meta fields when stamping, and refuses an unreadable version', async () => {
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 1, note: 'keep me' }))
  await prepareData()
  assert.deepEqual(JSON.parse(localStorage.getItem('hisaab:meta')), { version: CUR, note: 'keep me' })

  store.clear()
  seedData()
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 'banana' }))
  const r = await prepareData()
  assert.deepEqual([r.blocked, r.reason], [true, 'unreadable-version'])
  assert.equal(JSON.parse(localStorage.getItem('hisaab:meta')).version, 'banana', 'untouched')
})
