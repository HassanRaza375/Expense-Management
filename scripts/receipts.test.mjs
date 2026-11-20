// Phase 5: expense receipts (utils/receipts.js, useExpenses receipts, backup round trip, reset).
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

const { validateReceiptFile, receiptStats, exportableAttachments, formatBytes, MAX_RECEIPT_BYTES, MAX_RECEIPTS_PER_EXPENSE } = await import('../app/utils/receipts.js')
const { useExpenses } = await import('../app/composables/useExpenses.js')
const { getAllAttachments, getAttachment, deleteAttachment, clearAllAttachments } = await import('../app/utils/attachments.js')
const { buildBackup, parseBackup, applyBackup } = await import('../app/utils/backup.js')
const { shrinkReceiptImage } = await import('../app/utils/receiptImage.js')

const ex = useExpenses()
const base = { date: '2026-11-02T07:00:00.000Z', amount: 100, categoryId: 'cat-food', note: 'x' }
const png = (n = 8, name = 'r.png') => new File([new Uint8Array(n).fill(7)], name, { type: 'image/png' })
const pdf = (n = 8) => new File([new Uint8Array(n).fill(9)], 'r.pdf', { type: 'application/pdf' })
const bytesOf = async (entry) => [...new Uint8Array(await entry.blob.arrayBuffer())]

beforeEach(async () => {
  ex.expenses.splice(0, ex.expenses.length)
  for (const a of await getAllAttachments()) await deleteAttachment(a.id)
})

// ---- pure rules -------------------------------------------------------------------------------------------------------

test('validateReceiptFile: photos and PDFs only, not empty, not huge, not too many', () => {
  assert.equal(validateReceiptFile(png()), null)
  assert.equal(validateReceiptFile(pdf()), null)
  assert.match(validateReceiptFile(new File([new Uint8Array(5)], 'a.txt', { type: 'text/plain' })), /photo or a PDF/)
  assert.match(validateReceiptFile(new File([], 'e.png', { type: 'image/png' })), /empty/)
  assert.match(validateReceiptFile({ type: 'image/png', size: MAX_RECEIPT_BYTES + 1 }), /too large/)
  assert.equal(validateReceiptFile({ type: 'image/png', size: MAX_RECEIPT_BYTES }), null, 'exactly at the limit is fine')
  assert.match(validateReceiptFile(png(), MAX_RECEIPTS_PER_EXPENSE), /up to 5 receipts/)
  assert.match(validateReceiptFile(null), /Choose a file/)
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
  assert.equal(formatBytes(-1), '0 B')
})

test('receiptStats: orphans are files whose expense is gone or no longer lists them; missing = listed but not stored', () => {
  const expenses = [
    { id: 'e1', receipts: [{ id: 'f1' }, { id: 'fMissing' }] },
    { id: 'e2' },
  ]
  const files = [
    { id: 'f1', expenseId: 'e1', kind: 'receipt', filename: 'a', size: 100 },
    { id: 'f2', expenseId: 'e1', kind: 'receipt', filename: 'b', size: 50 }, // e1 does not list it
    { id: 'f3', expenseId: 'gone', kind: 'receipt', filename: 'c', size: 25 }, // expense deleted
    { id: 'bill1', billId: 'b', kind: 'billFront', size: 999 }, // not a receipt: never counted
  ]
  const s = receiptStats(expenses, files)
  assert.equal(s.count, 3)
  assert.equal(s.bytes, 175)
  assert.deepEqual(s.orphans.map((o) => o.id), ['f2', 'f3'])
  assert.equal(s.orphanBytes, 75)
  assert.equal(s.missing, 1)
  assert.deepEqual(receiptStats([], []), { count: 0, bytes: 0, orphans: [], orphanBytes: 0, missing: 0 })
  assert.doesNotThrow(() => receiptStats(null, [null, {}, 'x']))
})

test('exportableAttachments: bill files always, receipts only when their expense exists', () => {
  const out = exportableAttachments(
    [{ id: 'a', kind: 'receipt', expenseId: 'e1' }, { id: 'b', kind: 'receipt', expenseId: 'gone' }, { id: 'c', kind: 'pdf', billId: 'x' }],
    [{ id: 'e1' }]
  )
  assert.deepEqual(out.map((a) => a.id), ['a', 'c'])
})

test('shrinkReceiptImage outside a browser returns the file untouched (and never throws)', async () => {
  const f = png(10)
  assert.equal(await shrinkReceiptImage(f), f)
  assert.equal(await shrinkReceiptImage(null), null)
})

// ---- the store ---------------------------------------------------------------------------------------------------------

test('addReceipt stores the exact bytes in IndexedDB and a small description on the expense', async () => {
  const e = ex.addExpense(base)
  const r = await ex.addReceipt(e.id, png(16))
  assert.deepEqual(Object.keys(r).sort(), ['filename', 'id', 'mimeType', 'size'])
  assert.deepEqual(ex.findById(e.id).receipts, [r])
  const entry = await getAttachment(r.id)
  assert.equal(entry.expenseId, e.id)
  assert.equal(entry.kind, 'receipt')
  assert.equal(entry.billId, undefined)
  assert.deepEqual(await bytesOf(entry), Array(16).fill(7))
  assert.equal('receipts' in ex.addExpense(base), false, 'a new expense has no receipts field')
})

test('addReceipt refuses bad files with a plain message and changes nothing', async () => {
  const e = ex.addExpense(base)
  await assert.rejects(() => ex.addReceipt(e.id, new File([new Uint8Array(3)], 'a.txt', { type: 'text/plain' })), /photo or a PDF/)
  await assert.rejects(() => ex.addReceipt('nope', png()), /no longer exists/)
  for (let i = 0; i < MAX_RECEIPTS_PER_EXPENSE; i++) await ex.addReceipt(e.id, png(4 + i))
  await assert.rejects(() => ex.addReceipt(e.id, png()), /up to 5 receipts/)
  assert.equal(ex.findById(e.id).receipts.length, MAX_RECEIPTS_PER_EXPENSE)
  assert.equal((await getAllAttachments()).length, MAX_RECEIPTS_PER_EXPENSE)
})

test('removeReceipt removes the description and the file; the receipts field disappears when empty', async () => {
  const e = ex.addExpense(base)
  const a = await ex.addReceipt(e.id, png(4))
  const b = await ex.addReceipt(e.id, pdf(5))
  await ex.removeReceipt(e.id, a.id)
  assert.deepEqual(ex.findById(e.id).receipts.map((r) => r.id), [b.id])
  assert.equal(await getAttachment(a.id), null)
  await ex.removeReceipt(e.id, b.id)
  assert.equal('receipts' in ex.findById(e.id), false)
  assert.equal((await getAllAttachments()).length, 0)
  await assert.doesNotReject(() => ex.removeReceipt('nope', 'x'))
})

test('SAFETY: deleting an expense keeps its files, and Undo (single and bulk) finds the receipts again', async () => {
  const e = ex.addExpense(base)
  const r = await ex.addReceipt(e.id, png(6))
  const removed = ex.deleteExpense(e.id)
  assert.equal(ex.findById(e.id), undefined)
  assert.ok(await getAttachment(r.id), 'the file is still stored')
  ex.undoDelete()
  assert.deepEqual(ex.findById(e.id).receipts, [r], 'the description came back with the record')

  const gone = ex.deleteMany([e.id])
  assert.equal(gone.length, 1)
  assert.ok(await getAttachment(r.id))
  ex.restoreMany(gone)
  assert.deepEqual(ex.findById(e.id).receipts, [r])
  assert.equal(removed.id, e.id)
})

test('a duplicate does NOT share the original receipts (deleting one must not break the other)', async () => {
  const e = ex.addExpense(base)
  await ex.addReceipt(e.id, png(6))
  const copy = ex.duplicateExpense(e.id)
  assert.equal('receipts' in copy, false)
  assert.equal(ex.findById(e.id).receipts.length, 1)
})

test('an expense deleted WHILE its receipt is being saved leaves no dangling file', async () => {
  const e = ex.addExpense(base)
  const pending = ex.addReceipt(e.id, png(6))
  ex.deleteExpense(e.id) // before the async save resumes
  await assert.rejects(pending, /no longer exists/)
  assert.equal((await getAllAttachments()).length, 0)
})

test('orphan clean-up: after deleting an expense the stats show its file, and removing the listed ids frees it', async () => {
  const keep = ex.addExpense(base)
  const drop = ex.addExpense(base)
  await ex.addReceipt(keep.id, png(10))
  await ex.addReceipt(drop.id, png(20))
  ex.deleteExpense(drop.id)
  const s = receiptStats(ex.expenses, await getAllAttachments())
  assert.equal(s.orphans.length, 1)
  assert.equal(s.orphanBytes, 20)
  for (const o of s.orphans) await deleteAttachment(o.id)
  const after = receiptStats(ex.expenses, await getAllAttachments())
  assert.deepEqual([after.count, after.orphans.length, after.missing], [1, 0, 0])
})

// ---- backup --------------------------------------------------------------------------------------------------------------

test('backup: receipts of existing expenses travel with the file (bytes and expenseId intact); orphans do not', async () => {
  const keep = ex.addExpense(base)
  const drop = ex.addExpense(base)
  const r1 = await ex.addReceipt(keep.id, png(12, 'keep.png'))
  await ex.addReceipt(drop.id, pdf(9))
  ex.deleteExpense(drop.id)
  await new Promise((res) => setTimeout(res, 20)) // let the store persist

  const bundle = await buildBackup({ includeAttachments: true })
  assert.equal(bundle.attachments.length, 1, 'the orphan was left out')
  assert.equal(bundle.attachments[0].expenseId, keep.id)
  assert.equal(bundle.attachments[0].kind, 'receipt')

  // wipe files + expenses, then restore through the real parser/apply
  await clearAllAttachments()
  ex.expenses.splice(0, ex.expenses.length)
  await new Promise((res) => setTimeout(res, 20)) // let the in-memory store's writer settle first (the real app reloads after an import)
  store.delete('hisaab:expenses')
  const parsed = parseBackup(JSON.stringify(bundle))
  assert.equal(parsed.ok, true, parsed.errors.join('; '))
  const result = await applyBackup(parsed.backup)
  assert.equal(result.restoredAttachments, 1)
  const restoredExpenses = JSON.parse(localStorage.getItem('hisaab:expenses'))
  assert.deepEqual(restoredExpenses.find((e) => e.id === keep.id).receipts, [r1])
  const entry = await getAttachment(r1.id)
  assert.equal(entry.expenseId, keep.id)
  assert.equal(entry.filename, 'keep.png')
  assert.deepEqual(await bytesOf(entry), Array(12).fill(7))
})

test('backup without attachments carries no files but the expense still lists its receipt (it will show as missing until restored)', async () => {
  const e = ex.addExpense(base)
  await ex.addReceipt(e.id, png(5))
  await new Promise((res) => setTimeout(res, 20))
  const bundle = await buildBackup({ includeAttachments: false })
  assert.equal(bundle.attachments, undefined)
  assert.equal(bundle.data.expenses[0].receipts.length, 1)
})

test('Reset all data can clear every stored file (clearAllAttachments)', async () => {
  const e = ex.addExpense(base)
  await ex.addReceipt(e.id, png(5))
  assert.equal((await getAllAttachments()).length, 1)
  await clearAllAttachments()
  assert.equal((await getAllAttachments()).length, 0)
})
