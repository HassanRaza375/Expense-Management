import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS, registerState } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { putAttachment, deleteAttachment } from '../utils/attachments.js'
import { validateReceiptFile } from '../utils/receipts.js'
import { shrinkReceiptImage } from '../utils/receiptImage.js'

const state = reactive(get(STORAGE_KEYS.EXPENSES, []))

// lets a change that arrives from the account (account mode) reach this state without a reload
registerState(STORAGE_KEYS.EXPENSES, state)

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.EXPENSES, val)
  },
  { deep: true }
)

let pendingUndo = null

export function useExpenses() {
  function findById(id) {
    return state.find((e) => e.id === id)
  }

  // `kind` is optional. Only 'refund' is ever stored (amount stays POSITIVE); an ordinary expense has
  // no `kind` field at all, so existing records and new ordinary expenses have exactly the same shape.
  function addExpense({ date, amount, categoryId, note, source = 'manual', recurringId = null, billId = null, kind, accountId }) {
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    if (!categoryId) throw new Error('Category is required')
    if (kind !== undefined && kind !== 'expense' && kind !== 'refund') throw new Error('Kind must be "expense" or "refund"')
    const expense = {
      id: generateId(),
      date: date || new Date().toISOString(),
      amount: amt,
      categoryId,
      note: note || '',
      source, // 'manual' | 'recurring' | 'bill'
      recurringId,
      billId,
      createdAt: new Date().toISOString(),
    }
    if (kind === 'refund') expense.kind = 'refund'
    if (accountId) expense.accountId = accountId // optional; absent = Unassigned
    state.push(expense)
    return expense
  }

  function updateExpense(id, patch) {
    const exp = findById(id)
    if (!exp) return
    if (patch.amount !== undefined) {
      const amt = Number(patch.amount)
      if (!(amt > 0)) throw new Error('Amount must be greater than 0')
      exp.amount = amt
    }
    if (patch.kind !== undefined) {
      if (patch.kind !== 'expense' && patch.kind !== 'refund') throw new Error('Kind must be "expense" or "refund"')
      if (patch.kind === 'refund') exp.kind = 'refund'
      else delete exp.kind
    }
    if (patch.accountId !== undefined) {
      if (patch.accountId) exp.accountId = patch.accountId
      else delete exp.accountId
    }
    if (patch.date !== undefined) exp.date = patch.date
    if (patch.categoryId !== undefined) exp.categoryId = patch.categoryId
    if (patch.note !== undefined) exp.note = patch.note
  }

  function deleteExpense(id) {
    const idx = state.findIndex((e) => e.id === id)
    if (idx === -1) return null
    const [removed] = state.splice(idx, 1)
    pendingUndo = removed
    return removed
  }

  function undoDelete() {
    if (pendingUndo) {
      state.push(pendingUndo)
      pendingUndo = null
    }
  }

  function duplicateExpense(id) {
    const exp = findById(id)
    if (!exp) return null
    const copy = {
      ...exp,
      id: generateId(),
      date: new Date().toISOString(),
      source: 'manual',
      recurringId: null,
      billId: null,
      createdAt: new Date().toISOString(),
    }
    delete copy.receipts // the copy must NOT share the original's receipt files (deleting one would delete the other's)
    state.push(copy)
    return copy
  }

  // Returns the removed records so the caller can offer Undo via restoreMany().
  function deleteMany(ids) {
    const idSet = new Set(ids)
    const removed = []
    for (let i = state.length - 1; i >= 0; i--) {
      if (idSet.has(state[i].id)) removed.push(...state.splice(i, 1))
    }
    return removed.reverse()
  }

  function restoreMany(items) {
    const present = new Set(state.map((e) => e.id))
    for (const item of items || []) {
      if (!present.has(item.id)) state.push(item)
    }
  }

  // Bulk "Assign account" (Phase 2.4). `changes` come from assignmentPlan(): [{ id, from, to }]. '' = no account.
  // Returns the changes it applied so the caller can offer Undo via undoAssignAccount().
  function applyAccountChanges(changes) {
    const applied = []
    for (const c of changes || []) {
      const e = findById(c.id)
      if (!e) continue
      if (c.to) e.accountId = c.to
      else delete e.accountId
      applied.push(c)
    }
    return applied
  }

  function undoAssignAccount(changes) {
    for (const c of changes || []) {
      const e = findById(c.id)
      if (!e) continue
      if (c.from) e.accountId = c.from
      else delete e.accountId
    }
  }

  // ---- receipts ----
  // The file goes into IndexedDB first, then the small description onto the expense, so a failed save never leaves an
  // expense pointing at a file that is not there. A large photo is shrunk first (see utils/receiptImage.js).
  // Returns the receipt description. Throws an Error with a plain-sentence message.
  async function addReceipt(expenseId, file) {
    const expense = findById(expenseId)
    if (!expense) throw new Error('That expense no longer exists')
    const problem = validateReceiptFile(file, (expense.receipts || []).length)
    if (problem) throw new Error(problem)
    const prepared = await shrinkReceiptImage(file)
    const tooBig = validateReceiptFile(prepared, 0)
    if (tooBig) throw new Error(tooBig)
    const id = generateId()
    try {
      await putAttachment({ id, expenseId, kind: 'receipt', filename: prepared.name || 'receipt', mimeType: prepared.type, size: prepared.size, blob: prepared })
    } catch {
      throw new Error('Could not save the receipt (browser storage may be full)')
    }
    const live = findById(expenseId)
    if (!live) {
      // the expense was deleted while the file was being saved: keep nothing dangling
      await deleteAttachment(id).catch(() => {})
      throw new Error('That expense no longer exists')
    }
    const receipt = { id, filename: prepared.name || 'receipt', mimeType: prepared.type, size: prepared.size }
    if (!Array.isArray(live.receipts)) live.receipts = []
    live.receipts.push(receipt)
    return receipt
  }

  // Removes the description first, then the file (a failure leaves an orphan file, never a dangling description).
  async function removeReceipt(expenseId, receiptId) {
    const expense = findById(expenseId)
    if (!expense || !Array.isArray(expense.receipts)) return
    expense.receipts = expense.receipts.filter((r) => r.id !== receiptId)
    if (!expense.receipts.length) delete expense.receipts
    await deleteAttachment(receiptId).catch(() => {})
  }

  function reassignCategory(fromCategoryId, toCategoryId) {
    state.forEach((e) => {
      if (e.categoryId === fromCategoryId) e.categoryId = toCategoryId
    })
  }

  // Used when a bill is deleted: the money was still spent, so the expense stays, but it no longer points at the bill.
  // Returns the ids it unlinked so the delete can be undone with restoreBillLinks().
  function clearBillLinks(billId) {
    const ids = []
    for (const e of state) {
      if (e.billId === billId) {
        e.billId = null
        ids.push(e.id)
      }
    }
    return ids
  }

  function restoreBillLinks(ids, billId) {
    for (const id of ids || []) {
      const e = findById(id)
      if (e && !e.billId) e.billId = billId
    }
  }

  return {
    expenses: state,
    findById,
    applyAccountChanges,
    undoAssignAccount,
    addReceipt,
    removeReceipt,
    addExpense,
    updateExpense,
    deleteExpense,
    undoDelete,
    duplicateExpense,
    deleteMany,
    restoreMany,
    reassignCategory,
    clearBillLinks,
    restoreBillLinks,
  }
}
