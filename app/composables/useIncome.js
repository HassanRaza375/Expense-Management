import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

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

  function addIncome({ date, amount, sourceType, note, accountId }) {
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
    if (accountId) income.accountId = accountId // optional; absent = Unassigned
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
    if (patch.accountId !== undefined) {
      if (patch.accountId) income.accountId = patch.accountId
      else delete income.accountId
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

  return {
    income: state,
    findById,
    addIncome,
    updateIncome,
    deleteIncome,
    undoDelete,
  }
}
