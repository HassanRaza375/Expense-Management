import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { isWithinCycle } from '../utils/date.js'

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

  function addExpense({ date, amount, categoryId, note, source = 'manual', recurringId = null, billId = null }) {
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    if (!categoryId) throw new Error('Category is required')
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

  function deleteMany(ids) {
    const idSet = new Set(ids)
    for (let i = state.length - 1; i >= 0; i--) {
      if (idSet.has(state[i].id)) state.splice(i, 1)
    }
  }

  function reassignCategory(fromCategoryId, toCategoryId) {
    state.forEach((e) => {
      if (e.categoryId === fromCategoryId) e.categoryId = toCategoryId
    })
  }

  function inCycle(cycle) {
    return state.filter((e) => isWithinCycle(e.date, cycle))
  }

  function groupedByDay(list) {
    const groups = {}
    for (const e of list) {
      const day = e.date.slice(0, 10)
      if (!groups[day]) groups[day] = []
      groups[day].push(e)
    }
    return Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        total: items.reduce((sum, e) => sum + e.amount, 0),
      }))
  }

  function groupedByWeek(list) {
    const groups = {}
    for (const e of list) {
      const d = new Date(e.date)
      const weekStart = new Date(d)
      weekStart.setHours(0, 0, 0, 0)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const key = weekStart.toISOString().slice(0, 10)
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    }
    return Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([week, items]) => ({
        week,
        items,
        total: items.reduce((sum, e) => sum + e.amount, 0),
      }))
  }

  function groupedByMonth(list) {
    const groups = {}
    for (const e of list) {
      const key = e.date.slice(0, 7)
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    }
    return Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, items]) => ({
        month,
        items,
        total: items.reduce((sum, e) => sum + e.amount, 0),
      }))
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
    reassignCategory,
    inCycle,
    groupedByDay,
    groupedByWeek,
    groupedByMonth,
  }
}
