import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { clampDueDay, startOfDay } from '../utils/date.js'

const state = reactive(get(STORAGE_KEYS.RECURRING, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.RECURRING, val)
  },
  { deep: true }
)

export function useRecurring() {
  function findById(id) {
    return state.find((r) => r.id === id)
  }

  function addTemplate({ name, categoryId, amountMode, amount, dueDay, leadDays, endDate, accountId }) {
    if (!name || !name.trim()) throw new Error('Name is required')
    if (!categoryId) throw new Error('Category is required')
    const template = {
      id: generateId(),
      name: name.trim(),
      categoryId,
      amountMode: amountMode === 'variable' ? 'variable' : 'fixed',
      amount: amountMode === 'fixed' ? Number(amount) || 0 : null,
      dueDay: Math.min(Math.max(Number(dueDay) || 1, 1), 31),
      leadDays: Number(leadDays) || 0,
      endDate: endDate || null,
      active: true,
      lastConfirmedCycle: null,
      createdAt: new Date().toISOString(),
    }
    if (accountId) template.accountId = accountId // optional; absent = the default account (if any) when confirmed
    state.push(template)
    return template
  }

  function updateTemplate(id, patch) {
    const tpl = findById(id)
    if (!tpl) return
    const { accountId, ...rest } = patch
    Object.assign(tpl, rest)
    if (accountId !== undefined) {
      if (accountId) tpl.accountId = accountId
      else delete tpl.accountId
    }
  }

  function togglePause(id) {
    const tpl = findById(id)
    if (tpl) tpl.active = !tpl.active
  }

  function deleteTemplate(id) {
    const idx = state.findIndex((r) => r.id === id)
    if (idx !== -1) state.splice(idx, 1)
  }

  function effectiveDueDate(tpl, cycleStart) {
    const day = clampDueDay(tpl.dueDay, cycleStart.getFullYear(), cycleStart.getMonth())
    return new Date(cycleStart.getFullYear(), cycleStart.getMonth(), day)
  }

  function isPastEndDate(tpl, referenceDate) {
    if (!tpl.endDate) return false
    return startOfDay(referenceDate) > startOfDay(new Date(tpl.endDate))
  }

  function getPending(cycle, today = new Date()) {
    const cycleStartKey = cycle.start.toISOString().slice(0, 10)
    return state.filter((tpl) => {
      if (!tpl.active) return false
      if (isPastEndDate(tpl, today)) return false
      if (tpl.lastConfirmedCycle === cycleStartKey) return false
      const dueDate = effectiveDueDate(tpl, cycle.start)
      const promptFrom = new Date(dueDate)
      promptFrom.setDate(promptFrom.getDate() - (tpl.leadDays || 0))
      return startOfDay(today) >= startOfDay(promptFrom)
    })
  }

  function stampConfirmed(id, cycleStart) {
    const tpl = findById(id)
    if (tpl) tpl.lastConfirmedCycle = cycleStart.toISOString().slice(0, 10)
  }

  function sortedByDueDate(cycle) {
    return [...state]
      .filter((t) => t.active)
      .sort((a, b) => effectiveDueDate(a, cycle.start) - effectiveDueDate(b, cycle.start))
  }

  return {
    recurring: state,
    findById,
    addTemplate,
    updateTemplate,
    togglePause,
    deleteTemplate,
    effectiveDueDate,
    getPending,
    stampConfirmed,
    sortedByDueDate,
  }
}
