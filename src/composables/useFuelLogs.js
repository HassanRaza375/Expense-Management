import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { useExpenses } from './useExpenses.js'
import { useCategories } from './useCategories.js'
import { useVehicles } from './useVehicles.js'

const state = reactive(get(STORAGE_KEYS.FUEL_LOGS, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.FUEL_LOGS, val)
  },
  { deep: true }
)

const FUEL_CATEGORY_NAME = 'Fuel'

let pendingUndo = null

function ensureFuelCategory() {
  const { categories, addCategory } = useCategories()
  const existing = categories.find((c) => c.name.toLowerCase() === FUEL_CATEGORY_NAME.toLowerCase())
  if (existing) return existing
  return addCategory({ name: FUEL_CATEGORY_NAME, icon: '⛽', color: '#D6963A' })
}

export function useFuelLogs() {
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

  function addFuelLog({ vehicleId, date, odometer, liters, cost, fullTank, stationName, notes }) {
    if (!vehicleId) throw new Error('Vehicle is required')
    const vehicle = findVehicle(vehicleId)
    if (!vehicle) throw new Error('Vehicle not found')
    const litersNum = Number(liters)
    if (!(litersNum > 0)) throw new Error('Liters must be greater than 0')
    const odometerNum = Number(odometer)
    if (!(odometerNum > 0)) throw new Error('Odometer reading must be greater than 0')
    const amount = Number(cost) || 0

    const log = {
      id: generateId(),
      vehicleId,
      date: date || new Date().toISOString(),
      odometer: odometerNum,
      liters: litersNum,
      cost: amount,
      fullTank: fullTank !== false,
      stationName: stationName || '',
      notes: notes || '',
      linkedExpenseId: null,
      createdAt: new Date().toISOString(),
    }

    if (amount > 0) {
      const category = ensureFuelCategory()
      const expense = addExpense({
        date: log.date,
        amount,
        categoryId: category.id,
        note: `${vehicle.name} — Fuel (${litersNum} L)`,
        source: 'manual',
      })
      log.linkedExpenseId = expense.id
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
    if (patch.fullTank !== undefined) log.fullTank = !!patch.fullTank
    if (patch.stationName !== undefined) log.stationName = patch.stationName
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
        const category = ensureFuelCategory()
        const expense = addExpense({
          date: log.date,
          amount,
          categoryId: category.id,
          note: `${vehicle?.name || 'Vehicle'} — Fuel (${log.liters} L)`,
          source: 'manual',
        })
        log.linkedExpenseId = expense.id
      }
    } else if (patch.date !== undefined && log.linkedExpenseId) {
      updateExpense(log.linkedExpenseId, { date: log.date })
    }
  }

  function deleteFuelLog(id) {
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
    fuelLogs: state,
    findById,
    logsForVehicle,
    addFuelLog,
    updateFuelLog,
    deleteFuelLog,
    undoDelete,
    mileageStats,
    totalCostForVehicle,
    groupedByMonth,
  }
}
