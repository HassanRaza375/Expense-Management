import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { isWithinCycle } from '../utils/date.js'

const state = reactive(get(STORAGE_KEYS.INCOME, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.INCOME, val)
  },
  { deep: true }
)

export const INCOME_SOURCES = ['salary', 'business', 'freelance', 'investment', 'gift', 'other']

export const INCOME_SOURCE_LABELS = {
  salary: 'Salary',
  business: 'Business',
  freelance: 'Freelance',
  investment: 'Investment',
  gift: 'Gift',
  other: 'Other',
}

let pendingUndo = null

export function useIncome() {
  function findById(id) {
    return state.find((i) => i.id === id)
  }

  function addIncome({ date, amount, sourceType, note }) {
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    const income = {
      id: generateId(),
      date: date || new Date().toISOString(),
      amount: amt,
      sourceType: INCOME_SOURCES.includes(sourceType) ? sourceType : 'other',
      note: note || '',
      createdAt: new Date().toISOString(),
    }
    state.push(income)
    return income
  }

  function updateIncome(id, patch) {
    const income = findById(id)
    if (!income) return
    if (patch.amount !== undefined) {
      const amt = Number(patch.amount)
      if (!(amt > 0)) throw new Error('Amount must be greater than 0')
      income.amount = amt
    }
    if (patch.date !== undefined) income.date = patch.date
    if (patch.sourceType !== undefined) income.sourceType = INCOME_SOURCES.includes(patch.sourceType) ? patch.sourceType : 'other'
    if (patch.note !== undefined) income.note = patch.note
  }

  function deleteIncome(id) {
    const idx = state.findIndex((i) => i.id === id)
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

  function inCycle(cycle) {
    return state.filter((i) => isWithinCycle(i.date, cycle))
  }

  function groupedByDay(list) {
    const groups = {}
    for (const i of list) {
      const day = i.date.slice(0, 10)
      if (!groups[day]) groups[day] = []
      groups[day].push(i)
    }
    return Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        total: items.reduce((sum, i) => sum + i.amount, 0),
      }))
  }

  return {
    income: state,
    findById,
    addIncome,
    updateIncome,
    deleteIncome,
    undoDelete,
    inCycle,
    groupedByDay,
  }
}
