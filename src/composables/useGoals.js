import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { localDayKey, isDayKey } from '../utils/reporting.js'
import { validateGoal, goalProgress } from '../utils/goals.js'

// Savings goals (Phase 5). All the arithmetic is in utils/goals.js (pure); this file only stores them.
const state = reactive(get(STORAGE_KEYS.GOALS, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.GOALS, val)
  },
  { deep: true }
)

let pendingUndo = null

function fail(errors) {
  throw new Error(errors.join('. '))
}

export function useGoals() {
  function findById(id) {
    return state.find((g) => g.id === id)
  }

  function addGoal({ name, targetAmount, targetDate = '', accountId = '', startDay, note = '' }) {
    const start = isDayKey(startDay) ? startDay : localDayKey(new Date())
    const errors = validateGoal({ name, targetAmount, targetDate, startDay: start })
    if (errors.length) fail(errors)
    const goal = {
      id: generateId(),
      name: String(name).trim(),
      targetAmount: Number(targetAmount),
      targetDate: targetDate || null,
      startDay: start,
      savings: [],
      note: note || '',
      createdAt: new Date().toISOString(),
    }
    if (accountId) goal.accountId = accountId // optional: the goal follows this account's balance
    state.push(goal)
    return goal
  }

  function updateGoal(id, patch) {
    const goal = findById(id)
    if (!goal) return
    const merged = { name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate, startDay: goal.startDay, ...patch }
    const errors = validateGoal(merged)
    if (errors.length) fail(errors)
    goal.name = String(merged.name).trim()
    goal.targetAmount = Number(merged.targetAmount)
    goal.targetDate = merged.targetDate || null
    if (patch.note !== undefined) goal.note = patch.note
    if (patch.accountId !== undefined) {
      if (patch.accountId) goal.accountId = patch.accountId
      else delete goal.accountId
    }
  }

  function deleteGoal(id) {
    const idx = state.findIndex((g) => g.id === id)
    if (idx === -1) return null
    const [removed] = state.splice(idx, 1)
    pendingUndo = { goal: removed, index: idx }
    return removed
  }

  function undoDelete() {
    if (!pendingUndo) return
    state.splice(Math.min(pendingUndo.index, state.length), 0, pendingUndo.goal)
    pendingUndo = null
  }

  // Manual savings: positive = money put aside, negative = taken out. Only used by goals that do not follow an account.
  function addSaving(goalId, { date, amount, note = '' }) {
    const goal = findById(goalId)
    if (!goal) throw new Error('Goal not found')
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt === 0) throw new Error('The amount must be a number and not be 0')
    if (!Array.isArray(goal.savings)) goal.savings = []
    goal.savings.push({ id: generateId(), date: isDayKey(date) ? date : localDayKey(new Date()), amount: amt, note: note || '', createdAt: new Date().toISOString() })
  }

  function deleteSaving(goalId, savingId) {
    const goal = findById(goalId)
    if (!goal || !Array.isArray(goal.savings)) return
    const idx = goal.savings.findIndex((s) => s.id === savingId)
    if (idx !== -1) goal.savings.splice(idx, 1)
  }

  // accountBalanceOf(id) -> the balance today, or null when the account does not exist (the caller owns the accounts store).
  function progress(goal, accountBalanceOf = () => null, now = new Date()) {
    return goalProgress(goal, { accountBalance: goal.accountId ? accountBalanceOf(goal.accountId) : null, now })
  }

  return { goals: state, findById, addGoal, updateGoal, deleteGoal, undoDelete, addSaving, deleteSaving, progress }
}
