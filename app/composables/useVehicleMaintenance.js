import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS, registerState } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { useExpenses } from './useExpenses.js'
import { useVehicles } from './useVehicles.js'
import { DEFAULT_MAINTENANCE_TAG_ID } from './useVehicleTags.js'

const state = reactive(get(STORAGE_KEYS.VEHICLE_LOGS, []))

// One-time migration: maintenance logs used to auto-create a linked Expense and use a
// fixed `type` field. Neither exists anymore — logs are now plain entries tagged via
// useVehicleTags. Clean up old data in place so it matches the current shape.
;(function migrateLegacyLogs() {
  let changed = false
  const { deleteExpense, findById: findExpense } = useExpenses()
  for (const log of state) {
    if (log.linkedExpenseId) {
      if (findExpense(log.linkedExpenseId)) deleteExpense(log.linkedExpenseId)
      log.linkedExpenseId = undefined
      changed = true
    }
    if (log.tagId === undefined) {
      log.tagId = log.type && log.type !== 'odometer' ? DEFAULT_MAINTENANCE_TAG_ID : null
      changed = true
    }
    if (log.type !== undefined) {
      log.type = undefined
      changed = true
    }
  }
  if (changed) set(STORAGE_KEYS.VEHICLE_LOGS, state)
})()

// lets a change that arrives from the account (account mode) reach this state without a reload
registerState(STORAGE_KEYS.VEHICLE_LOGS, state)

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.VEHICLE_LOGS, val)
  },
  { deep: true }
)

let pendingUndo = null

export function useVehicleMaintenance() {
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

  function addLog({ vehicleId, tagId, date, odometer, cost, title, vendor, nextDueOdometer, nextDueDate, notes }) {
    if (!vehicleId) throw new Error('Vehicle is required')
    const vehicle = findVehicle(vehicleId)
    if (!vehicle) throw new Error('Vehicle not found')

    const log = {
      id: generateId(),
      vehicleId,
      tagId: tagId || null,
      date: date || new Date().toISOString(),
      odometer: odometer !== '' && odometer != null ? Number(odometer) : null,
      cost: Number(cost) || 0,
      title: title || '',
      vendor: vendor || '',
      nextDueOdometer: nextDueOdometer !== '' && nextDueOdometer != null ? Number(nextDueOdometer) : null,
      nextDueDate: nextDueDate || null,
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }

    if (log.odometer != null) bumpOdometer(vehicleId, log.odometer)

    state.push(log)
    return log
  }

  function updateLog(id, patch) {
    const log = findById(id)
    if (!log) return
    if (patch.tagId !== undefined) log.tagId = patch.tagId || null
    if (patch.date !== undefined) log.date = patch.date
    if (patch.odometer !== undefined) {
      log.odometer = patch.odometer !== '' && patch.odometer != null ? Number(patch.odometer) : null
      if (log.odometer != null) bumpOdometer(log.vehicleId, log.odometer)
    }
    if (patch.cost !== undefined) log.cost = Number(patch.cost) || 0
    if (patch.title !== undefined) log.title = patch.title
    if (patch.vendor !== undefined) log.vendor = patch.vendor
    if (patch.nextDueOdometer !== undefined) {
      log.nextDueOdometer = patch.nextDueOdometer !== '' && patch.nextDueOdometer != null ? Number(patch.nextDueOdometer) : null
    }
    if (patch.nextDueDate !== undefined) log.nextDueDate = patch.nextDueDate
    if (patch.notes !== undefined) log.notes = patch.notes
  }

  function deleteLog(id) {
    const idx = state.findIndex((l) => l.id === id)
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

  function costInRange(vehicleId, start, end) {
    return logsForVehicle(vehicleId)
      .filter((l) => new Date(l.date) >= start && new Date(l.date) <= end)
      .reduce((sum, l) => sum + (l.cost || 0), 0)
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
    costInRange,
    groupedByMonth,
  }
}
