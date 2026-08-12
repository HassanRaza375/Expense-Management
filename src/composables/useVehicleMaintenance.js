import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { useExpenses } from './useExpenses.js'
import { useCategories } from './useCategories.js'
import { useVehicles } from './useVehicles.js'

const state = reactive(get(STORAGE_KEYS.VEHICLE_LOGS, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.VEHICLE_LOGS, val)
  },
  { deep: true }
)

export const LOG_TYPES = ['odometer', 'oil_change', 'part', 'service', 'other']

export const LOG_TYPE_LABELS = {
  odometer: 'Odometer reading',
  oil_change: 'Oil change',
  part: 'Part replaced',
  service: 'Service / tuning',
  other: 'Other',
}

const MAINTENANCE_CATEGORY_NAME = 'Vehicle Maintenance'

let pendingUndo = null

function ensureMaintenanceCategory() {
  const { categories, addCategory } = useCategories()
  const existing = categories.find((c) => c.name.toLowerCase() === MAINTENANCE_CATEGORY_NAME.toLowerCase())
  if (existing) return existing
  return addCategory({ name: MAINTENANCE_CATEGORY_NAME, icon: '🏍️', color: '#4A9498' })
}

export function useVehicleMaintenance() {
  const { addExpense, updateExpense, deleteExpense, findById: findExpense } = useExpenses()
  const { findById: findVehicle, bumpOdometer } = useVehicles()

  function findById(id) {
    return state.find((l) => l.id === id)
  }

  function logsForVehicle(vehicleId) {
    return state
      .filter((l) => l.vehicleId === vehicleId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }

  function latestLog(vehicleId) {
    return logsForVehicle(vehicleId)[0] || null
  }

  function addLog({ vehicleId, type, date, odometer, cost, title, vendor, nextDueOdometer, nextDueDate, notes }) {
    if (!vehicleId) throw new Error('Vehicle is required')
    const vehicle = findVehicle(vehicleId)
    if (!vehicle) throw new Error('Vehicle not found')
    const logType = LOG_TYPES.includes(type) ? type : 'other'
    const amount = Number(cost) || 0

    const log = {
      id: generateId(),
      vehicleId,
      type: logType,
      date: date || new Date().toISOString(),
      odometer: odometer !== '' && odometer != null ? Number(odometer) : null,
      cost: amount,
      title: title || '',
      vendor: vendor || '',
      nextDueOdometer: nextDueOdometer !== '' && nextDueOdometer != null ? Number(nextDueOdometer) : null,
      nextDueDate: nextDueDate || null,
      notes: notes || '',
      linkedExpenseId: null,
      createdAt: new Date().toISOString(),
    }

    if (amount > 0) {
      const category = ensureMaintenanceCategory()
      const expense = addExpense({
        date: log.date,
        amount,
        categoryId: category.id,
        note: `${vehicle.name} — ${LOG_TYPE_LABELS[logType]}${title ? ': ' + title : ''}`,
        source: 'manual',
      })
      log.linkedExpenseId = expense.id
    }

    if (log.odometer != null) bumpOdometer(vehicleId, log.odometer)

    state.push(log)
    return log
  }

  function updateLog(id, patch) {
    const log = findById(id)
    if (!log) return
    if (patch.type !== undefined) log.type = LOG_TYPES.includes(patch.type) ? patch.type : 'other'
    if (patch.date !== undefined) log.date = patch.date
    if (patch.odometer !== undefined) {
      log.odometer = patch.odometer !== '' && patch.odometer != null ? Number(patch.odometer) : null
      if (log.odometer != null) bumpOdometer(log.vehicleId, log.odometer)
    }
    if (patch.title !== undefined) log.title = patch.title
    if (patch.vendor !== undefined) log.vendor = patch.vendor
    if (patch.nextDueOdometer !== undefined) {
      log.nextDueOdometer = patch.nextDueOdometer !== '' && patch.nextDueOdometer != null ? Number(patch.nextDueOdometer) : null
    }
    if (patch.nextDueDate !== undefined) log.nextDueDate = patch.nextDueDate
    if (patch.notes !== undefined) log.notes = patch.notes

    if (patch.cost !== undefined) {
      const amount = Number(patch.cost) || 0
      log.cost = amount
      if (log.linkedExpenseId && findExpense(log.linkedExpenseId)) {
        if (amount > 0) {
          updateExpense(log.linkedExpenseId, { amount, date: log.date })
        } else {
          deleteExpense(log.linkedExpenseId)
          log.linkedExpenseId = null
        }
      } else if (amount > 0) {
        const vehicle = findVehicle(log.vehicleId)
        const category = ensureMaintenanceCategory()
        const expense = addExpense({
          date: log.date,
          amount,
          categoryId: category.id,
          note: `${vehicle?.name || 'Vehicle'} — ${LOG_TYPE_LABELS[log.type]}${log.title ? ': ' + log.title : ''}`,
          source: 'manual',
        })
        log.linkedExpenseId = expense.id
      }
    } else if (patch.date !== undefined && log.linkedExpenseId) {
      updateExpense(log.linkedExpenseId, { date: log.date })
    }
  }

  function deleteLog(id) {
    const idx = state.findIndex((l) => l.id === id)
    if (idx === -1) return null
    const [removed] = state.splice(idx, 1)
    let removedExpense = null
    if (removed.linkedExpenseId) {
      removedExpense = deleteExpense(removed.linkedExpenseId)
    }
    pendingUndo = { log: removed, expense: removedExpense }
    return removed
  }

  function undoDelete() {
    if (!pendingUndo) return
    if (pendingUndo.expense) {
      const { expenses } = useExpenses()
      expenses.push(pendingUndo.expense)
    }
    state.push(pendingUndo.log)
    pendingUndo = null
  }

  function dueSoon(days = 14, km = 500) {
    const now = new Date()
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return state.filter((l) => {
      const vehicle = findVehicle(l.vehicleId)
      const odometerDue = l.nextDueOdometer != null && vehicle && vehicle.currentOdometer >= l.nextDueOdometer - km
      const dateDue = l.nextDueDate && new Date(l.nextDueDate) <= horizon
      return odometerDue || dateDue
    })
  }

  function totalCostForVehicle(vehicleId) {
    return logsForVehicle(vehicleId).reduce((sum, l) => sum + (l.cost || 0), 0)
  }

  function groupedByMonth(list) {
    const groups = {}
    for (const l of list) {
      const key = l.date.slice(0, 7)
      if (!groups[key]) groups[key] = []
      groups[key].push(l)
    }
    return Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, items]) => ({
        month,
        items: items.sort((a, b) => new Date(b.date) - new Date(a.date)),
        total: items.reduce((sum, l) => sum + (l.cost || 0), 0),
      }))
  }

  return {
    logs: state,
    findById,
    logsForVehicle,
    latestLog,
    addLog,
    updateLog,
    deleteLog,
    undoDelete,
    dueSoon,
    totalCostForVehicle,
    groupedByMonth,
  }
}
