// ---------------------------------------------------------------------------
// Expense receipts (Phase 5). Pure: no Vue, no storage, no browser APIs.
//
// WHERE THINGS LIVE
//   * the file itself: IndexedDB `hisaab-attachments` / `files`, as { id, expenseId, kind: 'receipt', filename, mimeType, size, blob }
//   * a small description on the expense: expense.receipts = [{ id, filename, mimeType, size }]   (optional, absent = none)
//
// THE SAFETY RULE: deleting an expense NEVER deletes its files. So Undo (single, bulk, even after a reload) and
// restoring a snapshot (which has no files) always find their receipts again. Files whose expense no longer exists are
// "orphans"; they are only removed by an explicit, confirmed clean-up in Settings (receiptStats tells what would go).
// ---------------------------------------------------------------------------

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024 // per file, after any image shrinking
export const MAX_RECEIPTS_PER_EXPENSE = 5
export const RECEIPT_ACCEPT = 'image/*,application/pdf'

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** A plain-sentence problem with adding this file, or null when it is fine. `existingCount` = receipts already on the expense. */
export function validateReceiptFile(file, existingCount = 0) {
  if (!file || typeof file !== 'object') return 'Choose a file'
  const type = String(file.type || '')
  if (!(type.startsWith('image/') || type === 'application/pdf')) return 'A receipt must be a photo or a PDF'
  if (!(Number(file.size) > 0)) return 'That file is empty'
  if (Number(file.size) > MAX_RECEIPT_BYTES) return `That file is too large (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_RECEIPT_BYTES)}`
  if (existingCount >= MAX_RECEIPTS_PER_EXPENSE) return `An expense can have up to ${MAX_RECEIPTS_PER_EXPENSE} receipts`
  return null
}

const list = (x) => (Array.isArray(x) ? x.filter((r) => r !== null && typeof r === 'object') : [])

/**
 * What is stored for receipts, compared with the expenses.
 * attachments = the entries of the files store (only entries with kind 'receipt' count).
 * Returns { count, bytes, orphans: [{ id, filename, size }], orphanBytes, missing } where `missing` is the number of
 * receipts an expense lists whose file is not in the store (e.g. cleared browser data).
 */
export function receiptStats(expenses, attachments) {
  const files = list(attachments).filter((a) => a.kind === 'receipt')
  const byId = new Map(files.map((a) => [a.id, a]))
  const listedBy = new Map() // expenseId -> Set of receipt ids that expense lists
  let missing = 0
  for (const e of list(expenses)) {
    const ids = new Set()
    for (const r of list(e.receipts)) {
      ids.add(r.id)
      if (!byId.has(r.id)) missing++
    }
    listedBy.set(e.id, ids)
  }
  // an orphan: its expense is gone, or its expense no longer lists it (e.g. after restoring an older snapshot)
  const orphans = files.filter((a) => !(listedBy.get(a.expenseId)?.has(a.id)))
  const bytes = files.reduce((s, a) => s + (Number(a.size) || 0), 0)
  const orphanBytes = orphans.reduce((s, a) => s + (Number(a.size) || 0), 0)
  return { count: files.length, bytes, orphans: orphans.map((a) => ({ id: a.id, filename: a.filename, size: Number(a.size) || 0 })), orphanBytes, missing }
}

/** Which stored receipt files a backup should carry: bill files as before, receipts only when their expense exists. */
export function exportableAttachments(attachments, expenses) {
  const expenseIds = new Set(list(expenses).map((e) => e.id))
  return list(attachments).filter((a) => a.kind !== 'receipt' || expenseIds.has(a.expenseId))
}
