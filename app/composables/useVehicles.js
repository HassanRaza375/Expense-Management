import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const state = reactive(get(STORAGE_KEYS.VEHICLES, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.VEHICLES, val)
  },
  { deep: true }
)

export const VEHICLE_TYPES = ['bike', 'car']
export const FUEL_TYPES = ['petrol', 'diesel', 'cng', 'electric', 'other']

export function useVehicles() {
  function findById(id) {
    return state.find((v) => v.id === id)
  }

  function addVehicle({ name, type, make, model, year, registrationNumber, purchaseDate, currentOdometer, fuelType, notes }) {
    if (!name || !name.trim()) throw new Error('Name is required')
    const vehicle = {
      id: generateId(),
      name: name.trim(),
      type: VEHICLE_TYPES.includes(type) ? type : 'bike',
      make: make || '',
      model: model || '',
      year: year || '',
      registrationNumber: registrationNumber || '',
      purchaseDate: purchaseDate || null,
      currentOdometer: Number(currentOdometer) || 0,
      fuelType: FUEL_TYPES.includes(fuelType) ? fuelType : 'petrol',
      notes: notes || '',
      active: true,
      createdAt: new Date().toISOString(),
    }
    state.push(vehicle)
    return vehicle
  }

  function updateVehicle(id, patch) {
    const vehicle = findById(id)
    if (!vehicle) return
    Object.assign(vehicle, patch)
  }

  function bumpOdometer(id, reading) {
    const vehicle = findById(id)
    if (!vehicle) return
    const value = Number(reading)
    if (value > vehicle.currentOdometer) vehicle.currentOdometer = value
  }

  function canDelete(id, logs) {
    return !logs.some((l) => l.vehicleId === id)
  }

  function deleteVehicle(id, logs) {
    if (!canDelete(id, logs)) {
      throw new Error('Delete this vehicle’s maintenance and fuel logs before deleting the vehicle')
    }
    const idx = state.findIndex((v) => v.id === id)
    if (idx !== -1) state.splice(idx, 1)
  }

  return {
    vehicles: state,
    findById,
    addVehicle,
    updateVehicle,
    bumpOdometer,
    canDelete,
    deleteVehicle,
  }
}
