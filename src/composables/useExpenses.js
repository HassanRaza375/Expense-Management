import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const state = reactive(get(STORAGE_KEYS.EXPENSES, []))

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
  function addExpense({ date, amount, categoryId, note, source = 'manual', recurringId = null, billId = null, kind }) {
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
