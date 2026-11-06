// Bill deletion with a real Undo (attachments restored from memory), plus the IndexedDB-backed parts of Phase 0
// (backup attachments round trip, safety snapshots) that could not be tested in Node before the fake IndexedDB existed.
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

const { useExpenses } = await import('../src/composables/useExpenses.js')
const { useBills, useConnections } = await import('../src/composables/useBills.js')
const { useMeterReadings } = await import('../src/composables/useMeterReadings.js')
const { getAttachment, getAllAttachments, putAttachment, deleteAttachment } = await import('../src/utils/attachments.js')
const { buildBackup, parseBackup, applyBackup } = await import('../src/utils/backup.js')
const { saveSnapshot, listSnapshots, clearSnapshots, MAX_SNAPSHOTS } = await import('../src/utils/snapshots.js')
const { localNoonISO } = await import('../src/utils/reporting.js')

const ex = useExpenses()
const billsApi = useBills()
const readings = useMeterReadings()
const conn = useConnections().addConnection({ connectionName: 'Home', billType: 'electricity' })

let month = 0
const bytes = (...n) => new Uint8Array(n)
const file = (name, type, data) => new File([data], name, { type })
const readBytes = async (entry) => [...new Uint8Array(await entry.blob.arrayBuffer())]

async function billWithAttachments({ reading = 1234 } = {}) {
  month++
  const bill = billsApi.addBill({ connectionId: conn.id, billingMonth: `2026-${String(month).padStart(2, '0')}`, dueDate: '2026-12-20', amount: 2000, currentReading: reading })
  const live = billsApi.findBill(bill.id)
  await billsApi.addAttachment(live, file('front.png', 'image/png', bytes(1, 2, 3, 4)), 'billFront')
  await billsApi.addAttachment(live, file('bill.pdf', 'application/pdf', bytes(9, 8, 7)), 'pdf')
  return billsApi.findBill(bill.id)
}

beforeEach(async () => {
  ex.expenses.splice(0, ex.expenses.length)
  billsApi.bills.splice(0, billsApi.bills.length)
  readings.readings.splice(0, readings.readings.length)
  for (const a of await getAllAttachments()) await deleteAttachment(a.id)
  month = 0
})

test('deleteBill removes the bill, its files and its meter reading; the paid expense is kept', async () => {
  const bill = await billWithAttachments()
  billsApi.markPaid(bill.id, { paidDate: localNoonISO('2026-11-07'), paidBy: 'me', paymentMethod: 'cash', transactionReference: '', categoryId: 'cat-bills' })
  assert.equal((await getAllAttachments()).length, 2)
  assert.equal(readings.readings.filter((r) => r.billId === bill.id).length, 1)

  const snapshot = await billsApi.deleteBill(bill.id)

  assert.ok(snapshot)
  assert.equal(billsApi.findBill(bill.id), undefined)
  assert.equal((await getAllAttachments()).length, 0, 'the files are gone from IndexedDB')
  assert.equal(readings.readings.length, 0)
  assert.equal(ex.expenses.length, 1, 'the expense stays')
  assert.equal(ex.expenses[0].billId, null)
  assert.equal(snapshot.files.length, 2)
  assert.equal(snapshot.unreadable, 0)
})

test('restoreBill brings back the bill at its position, the FILE CONTENTS, the meter reading and the expense link', async () => {
  const first = await billWithAttachments({ reading: 100 })
  const middle = await billWithAttachments({ reading: 200 })
  const last = await billWithAttachments({ reading: 300 })
  billsApi.markPaid(middle.id, { paidDate: localNoonISO('2026-11-07'), paidBy: 'me', paymentMethod: 'cash', transactionReference: '', categoryId: 'cat-bills' })
  const before = JSON.parse(JSON.stringify(billsApi.findBill(middle.id)))
  const expenseId = ex.expenses[0].id

  const snapshot = await billsApi.deleteBill(middle.id)
  assert.deepEqual(billsApi.bills.map((b) => b.id), [first.id, last.id])

  const result = await billsApi.restoreBill(snapshot)

  assert.deepEqual(result, { restoredFiles: 2, failedFiles: 0 })
  assert.deepEqual(billsApi.bills.map((b) => b.id), [first.id, middle.id, last.id], 'same position')
  assert.deepEqual(JSON.parse(JSON.stringify(billsApi.findBill(middle.id))), before, 'the bill is exactly as it was')
  const restored = await Promise.all(before.attachments.map((a) => getAttachment(a.id)))
  assert.deepEqual(await readBytes(restored[0]), [1, 2, 3, 4], 'image bytes are identical')
  assert.deepEqual(await readBytes(restored[1]), [9, 8, 7], 'pdf bytes are identical')
  assert.equal(restored[0].mimeType, 'image/png')
  assert.equal(restored[1].filename, 'bill.pdf')
  assert.equal(readings.readings.filter((r) => r.billId === middle.id).length, 1)
  assert.equal(ex.findById(expenseId).billId, middle.id)
  assert.equal(billsApi.linkedBillFor(expenseId).id, middle.id)
})

test('files that could not be read before the delete are REPORTED on restore, never silently dropped', async () => {
  const bill = await billWithAttachments()
  await deleteAttachment(bill.attachments[0].id) // the file is already missing from IndexedDB, but the bill still lists it
  const snapshot = await billsApi.deleteBill(bill.id)
  assert.equal(snapshot.files.length, 1)
  assert.equal(snapshot.unreadable, 1)
  const result = await billsApi.restoreBill(snapshot)
  assert.deepEqual(result, { restoredFiles: 1, failedFiles: 1 })
  assert.ok(billsApi.findBill(bill.id), 'the bill itself still comes back')
})

test('restoring twice does not duplicate anything; deleting an unknown bill returns null', async () => {
  const bill = await billWithAttachments()
  const snapshot = await billsApi.deleteBill(bill.id)
  await billsApi.restoreBill(snapshot)
  const again = await billsApi.restoreBill(snapshot)
  assert.deepEqual(again, { restoredFiles: 0, failedFiles: 0 })
  assert.equal(billsApi.bills.length, 1)
  assert.equal(readings.readings.length, 1)
  assert.equal((await getAllAttachments()).length, 2)
  assert.equal(await billsApi.deleteBill('does-not-exist'), null)
  assert.equal(await billsApi.restoreBill(null).then((r) => r.restoredFiles), 0)
})

test('a bill with no files, no reading and no payment deletes and restores cleanly', async () => {
  month++
  const bill = billsApi.addBill({ connectionId: conn.id, billingMonth: '2026-12', dueDate: '2026-12-20', amount: 10 })
  const snapshot = await billsApi.deleteBill(bill.id)
  assert.deepEqual([snapshot.files.length, snapshot.readings.length, snapshot.expenseIds.length], [0, 0, 0])
  assert.deepEqual(await billsApi.restoreBill(snapshot), { restoredFiles: 0, failedFiles: 0 })
  assert.ok(billsApi.findBill(bill.id))
})

// ---- Phase 0 parts that needed an IndexedDB ----------------------------------------

test('backup WITH attachments: export -> delete the files -> import restores identical bytes and metadata', async () => {
  await putAttachment({ id: 'att-1', billId: 'b1', kind: 'billFront', filename: 'a.png', mimeType: 'image/png', size: 4, blob: new Blob([bytes(5, 6, 7, 8)], { type: 'image/png' }) })
  await putAttachment({ id: 'att-2', billId: 'b1', kind: 'pdf', filename: 'b.pdf', mimeType: 'application/pdf', size: 2, blob: new Blob([bytes(250, 251)], { type: 'application/pdf' }) })

  const text = JSON.stringify(await buildBackup({ includeAttachments: true }))
  const without = JSON.parse(JSON.stringify(await buildBackup({ includeAttachments: false })))
  assert.equal('attachments' in without, false, 'the toggle off leaves files out')

  await deleteAttachment('att-1')
  await deleteAttachment('att-2')
  assert.equal((await getAllAttachments()).length, 0)

  const parsed = parseBackup(text)
  assert.equal(parsed.ok, true, parsed.errors.join('; '))
  assert.equal(parsed.backup.attachments.length, 2)
  const report = await applyBackup(parsed.backup)
  assert.deepEqual([report.restoredAttachments, report.failedAttachments], [2, 0])

  const a1 = await getAttachment('att-1')
  const a2 = await getAttachment('att-2')
  assert.deepEqual(await readBytes(a1), [5, 6, 7, 8])
  assert.deepEqual(await readBytes(a2), [250, 251])
  assert.deepEqual([a1.billId, a1.kind, a1.filename, a1.mimeType, a1.size], ['b1', 'billFront', 'a.png', 'image/png', 4])
})

test('a restore never deletes attachments that were not in the file', async () => {
  await putAttachment({ id: 'keep-me', billId: 'b9', kind: 'pdf', filename: 'k.pdf', mimeType: 'application/pdf', size: 1, blob: new Blob([bytes(1)]) })
  const parsed = parseBackup(JSON.stringify({ kind: 'hisaab-full-backup', formatVersion: 1, data: { expenses: [] }, attachments: [] }))
  await applyBackup(parsed.backup)
  assert.ok(await getAttachment('keep-me'))
})

test('safety snapshots: newest first, only the latest 5 kept, no app-lock data, and a reset clears them', async () => {
  localStorage.setItem('hisaab:expenses', JSON.stringify([{ id: 'e1', date: '2026-11-01T07:00:00.000Z', amount: 5, categoryId: 'x' }]))
  localStorage.setItem('hisaab:applock', JSON.stringify({ passwordHash: 'SECRET-HASH', salt: 'S' }))
  for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
    await saveSnapshot(`reason-${i}`)
    await new Promise((r) => setTimeout(r, 3)) // distinct timestamps
  }
  const list = await listSnapshots()
  assert.equal(list.length, MAX_SNAPSHOTS)
  assert.equal(list[0].reason, `reason-${MAX_SNAPSHOTS + 1}`, 'newest first')
  assert.equal(list.at(-1).reason, 'reason-2', 'the two oldest were pruned')
  assert.equal(list[0].backup.data.expenses.length, 1)
  assert.equal(JSON.stringify(list).includes('SECRET-HASH'), false, 'the password record is never in a snapshot')
  assert.equal('attachments' in list[0].backup, false)

  await clearSnapshots()
  assert.equal((await listSnapshots()).length, 0)
})
