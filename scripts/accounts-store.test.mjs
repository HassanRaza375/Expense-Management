// Phase 2.2: the accounts store (useAccounts), its persistence, backup/restore/snapshot integration, the optional
// accountId on records, and the guard that nothing about spending changes when accounts exist.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const { nextTick } = await import('vue')
const { useAccounts } = await import('../src/composables/useAccounts.js')
const { useExpenses } = await import('../src/composables/useExpenses.js')
const { useIncome } = await import('../src/composables/useIncome.js')
const { useSettings } = await import('../src/composables/useSettings.js')
const { useBudget } = await import('../src/composables/useBudget.js')
const { buildBackup, parseBackup, summarizeBackup, applyBackup, BACKUP_MODULES, CURRENT_SCHEMA_VERSION } = await import('../src/utils/backup.js')
const { saveSnapshot, listSnapshots } = await import('../src/utils/snapshots.js')
const { STORAGE_KEYS } = await import('../src/utils/storage.js')
const { localDayKey } = await import('../src/utils/reporting.js')

const acc = useAccounts()
const ex = useExpenses()
const inc = useIncome()
const { settings, setDefaultAccountId, setLastAccountId } = useSettings()
const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()
const NOW = new Date(2026, 10, 20, 12)
const open = (name, extra = {}) => acc.addAccount({ name, type: 'bank', openingBalance: 1000, openingDate: '2026-11-01', ...extra })

beforeEach(() => {
  acc.accounts.splice(0)
  acc.transfers.splice(0)
  acc.adjustments.splice(0)
  ex.expenses.splice(0)
  inc.income.splice(0)
  settings.defaultAccountId = ''
  settings.lastAccountId = ''
  for (const k of [...store.keys()]) if (k.startsWith('hisaab:accounts')) store.delete(k)
  installFakeIndexedDB()
})

// ---- accounts ----------------------------------------------------------------------------------------------------

test('addAccount validates, trims, defaults and orders accounts', () => {
  const a = open('  Meezan  ')
  const b = acc.addAccount({ name: 'Wallet', type: 'wallet', openingBalance: '250.5', openingDate: '2026-11-05', notes: 'daily' })
  assert.deepEqual([a.name, a.archived, a.openingBalance, a.order], ['Meezan', false, 1000, 0])
  assert.deepEqual([b.openingBalance, b.notes, b.order], [250.5, 'daily', 1])
  assert.throws(() => open('meezan'), /already exists/)
  assert.throws(() => acc.addAccount({ name: '', type: 'bank', openingBalance: 0, openingDate: '2026-11-01' }), /name is required/)
  assert.throws(() => acc.addAccount({ name: 'X', type: 'crypto', openingBalance: 0, openingDate: '2026-11-01' }), /account type/)
  assert.throws(() => acc.addAccount({ name: 'X', type: 'cash', openingBalance: 'abc', openingDate: '2026-11-01' }), /number/)
  assert.throws(() => acc.addAccount({ name: 'X', type: 'cash', openingBalance: 0, openingDate: 'tomorrow' }), /valid day/)
  assert.equal(acc.accounts.length, 2, 'rejected accounts are not stored')
})

test('updateAccount, archive and unarchive; archived accounts leave the active list but keep their data', () => {
  const a = open('Bank')
  const b = open('Cash', { type: 'cash' })
  acc.updateAccount(a.id, { name: 'Bank Alfalah', openingBalance: 2000, notes: 'main' })
  assert.deepEqual([acc.findAccount(a.id).name, acc.findAccount(a.id).openingBalance, acc.findAccount(a.id).notes], ['Bank Alfalah', 2000, 'main'])
  assert.throws(() => acc.updateAccount(a.id, { name: 'Cash' }), /already exists/)
  acc.updateAccount(a.id, { name: 'bank alfalah' }) // its own name in another case is fine
  acc.archiveAccount(b.id)
  assert.deepEqual(acc.activeAccounts().map((x) => x.name), ['bank alfalah'])
  assert.equal(acc.accounts.length, 2)
  acc.unarchiveAccount(b.id)
  assert.equal(acc.activeAccounts().length, 2)
})

test('delete is blocked while ANY record references the account (archive instead); allowed when unused, with Undo', () => {
  const a = open('A')
  const b = open('B')
  const c = open('C')
  ex.addExpense({ date: noon(2026, 11, 3), amount: 5, categoryId: 'cat-food', accountId: a.id })
  assert.throws(() => acc.deleteAccount(a.id), /Archive it instead/)
  inc.addIncome({ date: noon(2026, 11, 3), amount: 5, sourceType: 'salary', accountId: b.id })
  assert.throws(() => acc.deleteAccount(b.id), /used by 1 record/)
  acc.addTransfer({ date: '2026-11-04', amount: 5, fromAccountId: c.id, toAccountId: a.id })
  assert.throws(() => acc.deleteAccount(c.id), /Archive it instead/)
  assert.equal(acc.referenceCount(a.id), 2)

  const d = open('D')
  setDefaultAccountId(d.id)
  setLastAccountId(d.id)
  acc.deleteAccount(d.id)
  assert.equal(acc.findAccount(d.id), undefined)
  assert.deepEqual([settings.defaultAccountId, settings.lastAccountId], ['', ''], 'a deleted account is no longer the default')
  acc.undoDeleteAccount()
  assert.equal(acc.accounts.at(-1).id, d.id, 'restored in its place')
})

// ---- transfers / corrections ----------------------------------------------------------------------------------------

test('transfers: saved at local noon, validated, editable, undoable, and never an expense or income', () => {
  const a = open('A')
  const b = open('B')
  const t = acc.addTransfer({ date: '2026-11-04', amount: '150.25', fromAccountId: a.id, toAccountId: b.id, note: 'rent' })
  assert.equal(localDayKey(t.date), '2026-11-04')
  assert.equal(new Date(t.date).getHours(), 12)
  assert.equal(t.amount, 150.25)
  assert.equal(ex.expenses.length + inc.income.length, 0, 'no expense and no income was created')
  assert.throws(() => acc.addTransfer({ date: '2026-11-04', amount: 1, fromAccountId: a.id, toAccountId: a.id }), /different/)
  assert.throws(() => acc.addTransfer({ date: '2026-11-04', amount: 0, fromAccountId: a.id, toAccountId: b.id }), /greater than 0/)
  acc.archiveAccount(b.id)
  assert.throws(() => acc.addTransfer({ date: '2026-11-04', amount: 1, fromAccountId: a.id, toAccountId: b.id }), /archived/)
  acc.updateTransfer(t.id, { amount: 99, note: 'rent (fixed)' }) // an existing transfer stays editable
  assert.deepEqual([acc.transfers[0].amount, acc.transfers[0].note], [99, 'rent (fixed)'])
  assert.throws(() => acc.updateTransfer(t.id, { amount: -5 }), /greater than 0/)
  acc.deleteTransfer(t.id)
  assert.equal(acc.transfers.length, 0)
  acc.undoDeleteTransfer()
  assert.equal(acc.transfers.length, 1)
  assert.equal(acc.deleteTransfer('nope'), null)
})

test('a transfer moves money between accounts and leaves the total alone', () => {
  const a = open('A', { openingBalance: 1000 })
  const b = open('B', { openingBalance: 200 })
  acc.addTransfer({ date: '2026-11-04', amount: 300, fromAccountId: a.id, toAccountId: b.id })
  assert.deepEqual([acc.balanceOf(a.id, { now: NOW }).balance, acc.balanceOf(b.id, { now: NOW }).balance], [700, 500])
  assert.equal(acc.overview({ now: NOW }).total, 1200)
})

test('records with accountId feed the balance; refunds credit the account; unassigned records do not count', () => {
  const a = open('A', { openingBalance: 1000 })
  ex.addExpense({ date: noon(2026, 11, 3), amount: 200, categoryId: 'cat-food', accountId: a.id })
  ex.addExpense({ date: noon(2026, 11, 4), amount: 50, categoryId: 'cat-food', kind: 'refund', accountId: a.id })
  ex.addExpense({ date: noon(2026, 11, 5), amount: 9999, categoryId: 'cat-food' }) // unassigned
  inc.addIncome({ date: noon(2026, 11, 6), amount: 300, sourceType: 'salary', accountId: a.id })
  assert.equal(acc.balanceOf(a.id, { now: NOW }).balance, 1000 - 200 + 50 + 300)
  assert.equal(acc.unassigned('2026-11-01').count, 1)
  const types = acc.ledger(a.id, { now: NOW }).map((r) => r.type)
  assert.deepEqual(types, ['opening', 'expense', 'refund', 'income'])
})

test('reconcile: a visible correction for the difference, none when it already matches, undoable', () => {
  const a = open('A', { openingBalance: 1000 })
  ex.addExpense({ date: noon(2026, 11, 3), amount: 200, categoryId: 'cat-food', accountId: a.id })
  const same = acc.reconcile(a.id, { actual: 800, asOf: '2026-11-20' })
  assert.deepEqual([same.needsCorrection, same.adjustment], [false, null])
  assert.equal(acc.adjustments.length, 0)

  const r = acc.reconcile(a.id, { actual: 750.5, asOf: '2026-11-20' })
  assert.deepEqual([r.expected, r.difference], [800, -49.5])
  assert.equal(r.adjustment.amount, -49.5)
  assert.equal(r.adjustment.reconciledTo, 750.5)
  assert.equal(localDayKey(r.adjustment.date), '2026-11-20')
  assert.equal(acc.balanceOf(a.id, { now: NOW }).balance, 750.5)
  assert.equal(acc.ledger(a.id, { now: NOW }).at(-1).type, 'correction')
  assert.equal(ex.expenses.length, 1, 'a correction is not spending')
  assert.throws(() => acc.reconcile(a.id, { actual: 'abc' }), /number/)
  assert.throws(() => acc.reconcile('ghost', { actual: 1 }), /not found/)

  acc.deleteAdjustment(r.adjustment.id)
  assert.equal(acc.balanceOf(a.id, { now: NOW }).balance, 800)
  acc.undoDeleteAdjustment()
  assert.equal(acc.balanceOf(a.id, { now: NOW }).balance, 750.5)
  assert.throws(() => acc.addAdjustment({ accountId: a.id, amount: 0, date: '2026-11-20' }), /non-zero/)
})

// ---- the optional accountId on records ------------------------------------------------------------------------------

test('accountId is stored only when given; ordinary records keep exactly the shape they had; it can be set and cleared', () => {
  const plain = ex.addExpense({ date: noon(2026, 11, 3), amount: 5, categoryId: 'cat-food' })
  assert.equal('accountId' in plain, false)
  assert.deepEqual(Object.keys(plain).sort(), ['amount', 'billId', 'categoryId', 'createdAt', 'date', 'id', 'note', 'recurringId', 'source'])
  const tagged = ex.addExpense({ date: noon(2026, 11, 3), amount: 5, categoryId: 'cat-food', accountId: 'acc-1' })
  assert.equal(tagged.accountId, 'acc-1')
  ex.updateExpense(tagged.id, { accountId: 'acc-2' })
  assert.equal(ex.findById(tagged.id).accountId, 'acc-2')
  ex.updateExpense(tagged.id, { accountId: '' })
  assert.equal('accountId' in ex.findById(tagged.id), false, 'cleared = Unassigned again')
  assert.equal('accountId' in ex.duplicateExpense(plain.id), false)

  const i1 = inc.addIncome({ date: noon(2026, 11, 3), amount: 5, sourceType: 'salary' })
  assert.equal('accountId' in i1, false)
  const i2 = inc.addIncome({ date: noon(2026, 11, 3), amount: 5, sourceType: 'salary', accountId: 'acc-1' })
  assert.equal(i2.accountId, 'acc-1')
  inc.updateIncome(i2.id, { accountId: undefined })
  assert.equal(inc.findById(i2.id).accountId, 'acc-1', 'undefined means "not part of this edit"')
  inc.updateIncome(i2.id, { accountId: null })
  assert.equal('accountId' in inc.findById(i2.id), false)
})

test('settings: defaultAccountId and lastAccountId are optional and start empty', () => {
  assert.deepEqual([settings.defaultAccountId, settings.lastAccountId], ['', ''])
  setDefaultAccountId('a1')
  setLastAccountId('a2')
  assert.deepEqual([settings.defaultAccountId, settings.lastAccountId], ['a1', 'a2'])
  setDefaultAccountId(undefined)
  assert.equal(settings.defaultAccountId, '')
})

// ---- persistence -------------------------------------------------------------------------------------------------

test('the whole store persists under ONE key as { accounts, transfers, adjustments }', async () => {
  const a = open('A')
  const b = open('B')
  acc.addTransfer({ date: '2026-11-04', amount: 5, fromAccountId: a.id, toAccountId: b.id })
  acc.addAdjustment({ accountId: a.id, amount: 1, date: '2026-11-05' })
  await nextTick()
  const saved = JSON.parse(localStorage.getItem('hisaab:accounts'))
  assert.deepEqual(Object.keys(saved).sort(), ['accounts', 'adjustments', 'transfers'])
  assert.deepEqual([saved.accounts.length, saved.transfers.length, saved.adjustments.length], [2, 1, 1])
  assert.equal(store.has('hisaab:transfers'), false, 'no separate keys')
})

// ---- nothing about spending changes ------------------------------------------------------------------------------

test('Dashboard/Budget numbers are IDENTICAL before and after creating accounts, tagging records and adding transfers and corrections', () => {
  settings.cycleResetDay = 6
  settings.overallBudget = 5000
  ex.addExpense({ date: noon(2026, 11, 7), amount: 1200, categoryId: 'cat-food' })
  ex.addExpense({ date: noon(2026, 11, 8), amount: 300, categoryId: 'cat-travel', kind: 'refund' })
  inc.addIncome({ date: noon(2026, 11, 7), amount: 9000, sourceType: 'salary' })
  const snap = () => {
    const b = useBudget(NOW)
    return JSON.stringify({ spent: b.cycleSpent.value, gross: b.cycleGross.value, refunds: b.cycleRefunds.value, remaining: b.overallRemaining.value, income: b.cycleIncome.value, cashflow: b.netCashflow.value, left: b.daysLeftInCycle.value, safe: b.safeToSpendPerDay.value, cats: b.categoryBreakdown.value.map((r) => [r.category.id, r.spent, r.percentUsed]) })
  }
  const before = snap()

  const a = open('A')
  const b = open('B', { type: 'cash' })
  for (const e of ex.expenses) ex.updateExpense(e.id, { accountId: a.id })
  for (const i of inc.income) inc.updateIncome(i.id, { accountId: b.id })
  acc.addTransfer({ date: '2026-11-09', amount: 500, fromAccountId: a.id, toAccountId: b.id })
  acc.reconcile(a.id, { actual: 12345.67, asOf: '2026-11-20' })

  assert.equal(snap(), before)
})

test('no spending/reporting module knows about accounts', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  for (const f of ['../src/utils/reporting.js', '../src/utils/budgetMath.js', '../src/composables/useBudget.js', '../src/utils/csvExport.js']) {
    assert.doesNotMatch(read(f), /accountId|accounts\.js|useAccounts|STORAGE_KEYS\.ACCOUNTS/, f)
  }
})

// ---- backup / restore / snapshots ---------------------------------------------------------------------------------

const seedWorld = () => {
  const a = open('A', { openingBalance: 1000 })
  const b = open('B', { type: 'card', openingBalance: -500 })
  ex.addExpense({ date: noon(2026, 11, 3), amount: 200, categoryId: 'cat-food', accountId: a.id })
  acc.addTransfer({ date: '2026-11-04', amount: 50, fromAccountId: a.id, toAccountId: b.id })
  acc.reconcile(a.id, { actual: 700, asOf: '2026-11-20' })
  return { a, b }
}

test('accounts are a backup module, counted, and the backup says data version 2 once the app is stamped', async () => {
  assert.ok(BACKUP_MODULES.some((m) => m.key === STORAGE_KEYS.ACCOUNTS && m.shape === 'accounts'))
  assert.equal(CURRENT_SCHEMA_VERSION, 2)
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 2 }))
  seedWorld()
  await nextTick()
  const backup = await buildBackup()
  assert.equal(backup.schemaVersion, 2)
  assert.equal(backup.counts.accounts, 2)
  assert.deepEqual(Object.keys(backup.data.accounts).sort(), ['accounts', 'adjustments', 'transfers'])
})

test('round trip: export -> wipe -> import restores the accounts store and every balance exactly', async () => {
  localStorage.setItem('hisaab:meta', JSON.stringify({ version: 2 }))
  const { a, b } = seedWorld()
  await nextTick()
  const before = { a: acc.balanceOf(a.id, { now: NOW }), b: acc.balanceOf(b.id, { now: NOW }) }
  const text = JSON.stringify(await buildBackup())

  store.delete('hisaab:accounts')
  const parsed = parseBackup(text)
  assert.equal(parsed.ok, true, parsed.errors.join('; '))
  assert.deepEqual(parsed.warnings, [])
  await applyBackup(parsed.backup)
  const restored = JSON.parse(localStorage.getItem('hisaab:accounts'))
  assert.deepEqual([restored.accounts.length, restored.transfers.length, restored.adjustments.length], [2, 1, 1])
  // balances recomputed from the restored raw data are identical
  const { accountBalance } = await import('../src/utils/accounts.js')
  const data = { expenses: ex.expenses, income: inc.income, transfers: restored.transfers, adjustments: restored.adjustments }
  assert.deepEqual(accountBalance(restored.accounts.find((x) => x.id === a.id), data, { now: NOW }), before.a)
  assert.deepEqual(accountBalance(restored.accounts.find((x) => x.id === b.id), data, { now: NOW }), before.b)
})

const minimal = (extra = {}) => ({ kind: 'hisaab-full-backup', formatVersion: 1, data: { expenses: [{ id: 'e', date: '2026-11-01T07:00:00.000Z', amount: 5, categoryId: 'x' }] }, ...extra })

test('backup compatibility matrix: v1 and v2 import, a newer data version is refused', () => {
  assert.equal(parseBackup(JSON.stringify(minimal({ schemaVersion: 1 }))).ok, true)
  assert.equal(parseBackup(JSON.stringify(minimal({ schemaVersion: 2 }))).ok, true)
  assert.equal(parseBackup(JSON.stringify(minimal())).ok, true, 'no schemaVersion at all (oldest files) is treated as 1')
  const v3 = parseBackup(JSON.stringify(minimal({ schemaVersion: 3 })))
  assert.equal(v3.ok, false)
  assert.match(v3.errors.join(), /newer data version \(3\)/)
})

test('importing a FULL backup from before accounts existed clears the accounts store, and the preview says so', async () => {
  seedWorld()
  await nextTick()
  const parsed = parseBackup(JSON.stringify(minimal({ schemaVersion: 1 })))
  assert.equal(parsed.backup.data.accounts, null, 'a full backup means "make this device match the file"')
  const rows = Object.fromEntries(summarizeBackup(parsed.backup).map((r) => [r.key, r]))
  assert.equal(rows.accounts.incoming, 'empty')
  assert.match(rows.accounts.current, /2 accounts, 1 transfers, 1 corrections/)
  assert.match(rows.accounts.note, /Will be cleared: this backup was made before accounts existed/)
  assert.equal(rows.expenses.note, '', 'the accounts are cleared as well, so there is nothing for the imported records to be unassigned against')
  await applyBackup(parsed.backup)
  assert.equal(localStorage.getItem('hisaab:accounts'), null)
})

test('legacy partial files and a v2 file WITHOUT accounts: legacy leaves the accounts alone; the note warns about Unassigned records', async () => {
  seedWorld()
  await nextTick()
  const legacy = parseBackup(JSON.stringify({ kind: 'hisaab-main-backup', expenses: [{ id: 'e', date: '2026-11-01T07:00:00.000Z', amount: 5, categoryId: 'x' }] }))
  assert.equal('accounts' in legacy.backup.data, false)
  const rows = summarizeBackup(legacy.backup)
  assert.deepEqual(rows.map((r) => r.key), ['expenses'])
  assert.match(rows[0].note, /stay Unassigned/)
  const keep = localStorage.getItem('hisaab:accounts')
  await applyBackup(legacy.backup)
  assert.equal(localStorage.getItem('hisaab:accounts'), keep, 'accounts untouched by a legacy partial file')

  const v2 = parseBackup(JSON.stringify(minimal({ schemaVersion: 2 })))
  assert.equal('accounts' in v2.backup.data, false, 'a v2 file that simply has no accounts section leaves them alone')
})

test('a device without accounts shows no accounts notes', () => {
  const parsed = parseBackup(JSON.stringify(minimal({ schemaVersion: 1 })))
  const rows = Object.fromEntries(summarizeBackup(parsed.backup).map((r) => [r.key, r]))
  assert.equal(rows.accounts.note, '')
  assert.equal(rows.expenses.note, '')
})

test('accounts store validation: wrong shapes are refused, orphans only warn', () => {
  const bad = (accounts) => parseBackup(JSON.stringify({ kind: 'hisaab-full-backup', formatVersion: 1, schemaVersion: 2, data: { accounts } }))
  for (const value of ['x', [], { accounts: 'nope' }, { accounts: [1] }, { transfers: {} }]) {
    const r = bad(value)
    assert.equal(r.ok, false, JSON.stringify(value))
    assert.match(r.errors.join(), /Accounts:/)
  }
  const ok = bad({ accounts: [{ id: 'a', name: 'A', type: 'bank', openingBalance: 0, openingDate: '2026-11-01' }], transfers: [{ id: 't', fromAccountId: 'a', toAccountId: 'ghost', amount: 5 }], adjustments: [{ id: 'x', accountId: 'ghost', amount: 1 }] })
  assert.equal(ok.ok, true)
  assert.ok(ok.warnings.some((w) => /transfer 1 refers to an account that is not in the file/.test(w)))
  assert.ok(ok.warnings.some((w) => /correction 1 refers to an account/.test(w)))
  const messy = bad({ accounts: [{ id: 'a', name: '', type: 'crypto', openingBalance: 'x', openingDate: 'no' }, { id: 'a', name: 'B', type: 'bank', openingBalance: 0, openingDate: '2026-11-01' }] })
  assert.equal(messy.ok, true)
  assert.ok(messy.warnings.length >= 4, messy.warnings.join(' | '))
})

test('safety snapshots include the accounts store, and never the app-lock record', async () => {
  localStorage.setItem('hisaab:applock', JSON.stringify({ passwordHash: 'SECRET-HASH', salt: 'S' }))
  seedWorld()
  await nextTick()
  await saveSnapshot('before-something')
  const [snap] = await listSnapshots()
  assert.equal(snap.backup.data.accounts.accounts.length, 2)
  assert.equal(snap.backup.data.accounts.transfers.length, 1)
  assert.equal(JSON.stringify(snap).includes('SECRET-HASH'), false)
})
