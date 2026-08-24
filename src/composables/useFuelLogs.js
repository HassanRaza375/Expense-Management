import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { useExpenses } from './useExpenses.js'
import { useVehicles } from './useVehicles.js'

const state = reactive(get(STORAGE_KEYS.FUEL_LOGS, []))

// One-time migration: fuel entries used to auto-create a linked Expense. They no longer
// do — a fuel log is just an entry. Remove any Expense rows created by past fuel logs.
;(function migrateLegacyLogs() {
  let changed = false
  const { deleteExpense, findById: findExpense } = useExpenses()
  for (const log of state) {
    if (log.linkedExpenseId) {
      if (findExpense(log.linkedExpenseId)) deleteExpense(log.linkedExpenseId)
      log.linkedExpenseId = undefined
      changed = true
    }
  }
  if (changed) set(STORAGE_KEYS.FUEL_LOGS, state)
})()

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.FUEL_LOGS, val)
  },
  { deep: true }
)

let pendingUndo = null

export function useFuelLogs() {
  const { findById: findVehicle, bumpOdometer } = useVehicles()

  function findById(id) {
    return state.find((l) => l.id === id)
  }

  function logsForVehicle(vehicleId) {
    return state
      .filter((l) => l.vehicleId === vehicleId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }

  function addFuelLog({ vehicleId, date, odometer, liters, cost, fullTank, stationName, notes }) {
    if (!vehicleId) throw new Error('Vehicle is required')
    const vehicle = findVehicle(vehicleId)
    if (!vehicle) throw new Error('Vehicle not found')
    const litersNum = Number(liters)
    if (!(litersNum > 0)) throw new Error('Liters must be greater than 0')
    const odometerNum = Number(odometer)
    if (!(odometerNum > 0)) throw new Error('Odometer reading must be greater than 0')

    const log = {
      id: generateId(),
      vehicleId,
      date: date || new Date().toISOString(),
      odometer: odometerNum,
      liters: litersNum,
      cost: Number(cost) || 0,
      fullTank: fullTank !== false,
      stationName: stationName || '',
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }

    bumpOdometer(vehicleId, odometerNum)
    state.push(log)
    return log
  }

  function updateFuelLog(id, patch) {
    const log = findById(id)
    if (!log) return
    if (patch.date !== undefined) log.date = patch.date
    if (patch.odometer !== undefined) {
      log.odometer = Number(patch.odometer)
      bumpOdometer(log.vehicleId, log.odometer)
    }
    if (patch.liters !== undefined) log.liters = Number(patch.liters)
    if (patch.cost !== undefined) log.cost = Number(patch.cost) || 0
    if (patch.fullTank !== undefined) log.fullTank = !!patch.fullTank
    if (patch.stationName !== undefined) log.stationName = patch.stationName
    if (patch.notes !== undefined) log.notes = patch.notes
  }

  function deleteFuelLog(id) {
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

  function mileageStats(vehicleId) {
    const logs = logsForVehicle(vehicleId)
      .slice()
      .sort((a, b) => a.odometer - b.odometer)
    const entries = []
    for (let i = 1; i < logs.length; i++) {
      const curr = logs[i]
      const prev = logs[i - 1]
      if (!curr.fullTank) continue
      const distance = curr.odometer - prev.odometer
      if (distance > 0 && curr.liters > 0) {
        entries.push({ date: curr.date, odometer: curr.odometer, mileage: distance / curr.liters })
      }
    }
    const average = entries.length ? entries.reduce((sum, e) => sum + e.mileage, 0) / entries.length : null
    return { average, entries: entries.reverse() }
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

  // Last N calendar months of fuel cost for one vehicle, oldest first — for a monthly trend chart.
  function monthlyCostForVehicle(vehicleId, monthsBack = 6) {
    const now = new Date()
    const months = []
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, date: d })
    }
    const logs = logsForVehicle(vehicleId)
    return months.map(({ key, date }) => {
      const total = logs
        .filter((l) => {
          const d = new Date(l.date)
          return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth()
        })
        .reduce((sum, l) => sum + (l.cost || 0), 0)
      return { month: key, total }
    })
  }

  return {
    fuelLogs: state,
    findById,
    logsForVehicle,
    addFuelLog,
    updateFuelLog,
    deleteFuelLog,
    undoDelete,
    mileageStats,
    totalCostForVehicle,
    costInRange,
    groupedByMonth,
    monthlyCostForVehicle,
  }
}
