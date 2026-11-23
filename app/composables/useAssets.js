import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS, registerState } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const state = reactive(get(STORAGE_KEYS.ASSETS, []))

// lets a change that arrives from the account (account mode) reach this state without a reload
registerState(STORAGE_KEYS.ASSETS, state)

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.ASSETS, val)
  },
  { deep: true }
)

export const ASSET_CATEGORIES = ['electronics', 'vehicle', 'furniture', 'jewelry', 'appliance', 'other']

export function useAssets() {
  function findById(id) {
    return state.find((a) => a.id === id)
  }

  function addAsset({ name, category, purchaseDate, purchasePrice, currentValue, warrantyExpiry, serialNumber, notes }) {
    if (!name || !name.trim()) throw new Error('Name is required')
    const asset = {
      id: generateId(),
      name: name.trim(),
      category: ASSET_CATEGORIES.includes(category) ? category : 'other',
      purchaseDate: purchaseDate || null,
      purchasePrice: Number(purchasePrice) || 0,
      currentValue: Number(currentValue) || Number(purchasePrice) || 0,
      warrantyExpiry: warrantyExpiry || null,
      serialNumber: serialNumber || '',
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }
    state.push(asset)
    return asset
  }

  function updateAsset(id, patch) {
    const asset = findById(id)
    if (!asset) return
    Object.assign(asset, patch)
  }

  function deleteAsset(id) {
    const idx = state.findIndex((a) => a.id === id)
    if (idx !== -1) state.splice(idx, 1)
  }

  function totalValue() {
    return state.reduce((sum, a) => sum + (Number(a.currentValue) || 0), 0)
  }

  function warrantiesExpiringSoon(days = 30) {
    const now = new Date()
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return state.filter((a) => a.warrantyExpiry && new Date(a.warrantyExpiry) >= now && new Date(a.warrantyExpiry) <= horizon)
  }

  return {
    assets: state,
    findById,
    addAsset,
    updateAsset,
    deleteAsset,
    totalValue,
    warrantiesExpiringSoon,
  }
}
