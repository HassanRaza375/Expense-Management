import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const defaultCategories = [
  { id: 'cat-food', name: 'Food', icon: '🍔', color: '#5FAE86', isDefault: false, order: 0 },
  { id: 'cat-bills', name: 'Bills', icon: '🧾', color: '#4A9498', isDefault: false, order: 1 },
  { id: 'cat-travel', name: 'Travel', icon: '🚗', color: '#D6963A', isDefault: false, order: 2 },
  { id: 'cat-health', name: 'Health/Vitamins', icon: '💊', color: '#8FA0AC', isDefault: false, order: 3 },
  { id: 'cat-gym', name: 'Gym', icon: '🏋️', color: '#2E6E72', isDefault: false, order: 4 },
  { id: 'cat-shopping', name: 'Shopping', icon: '🛍️', color: '#D9695F', isDefault: false, order: 5 },
  { id: 'cat-other', name: 'Other', icon: '📎', color: '#8FA0AC', isDefault: true, order: 6 },
].map((c) => ({ ...c, createdAt: new Date().toISOString() }))

function loadInitial() {
  const stored = get(STORAGE_KEYS.CATEGORIES, null)
  if (stored && stored.length) return stored
  return defaultCategories
}

const state = reactive(loadInitial())

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.CATEGORIES, val)
  },
  { deep: true }
)

export function useCategories() {
  function sorted() {
    return [...state].sort((a, b) => a.order - b.order)
  }

  function findById(id) {
    return state.find((c) => c.id === id)
  }

  function getOtherCategory() {
    return state.find((c) => c.isDefault) || state[0]
  }

  function nameExists(name, excludeId = null) {
    const lower = name.trim().toLowerCase()
    return state.some((c) => c.id !== excludeId && c.name.trim().toLowerCase() === lower)
  }

  function addCategory({ name, icon, color }) {
    const trimmed = (name || '').trim()
    if (!trimmed) throw new Error('Category name is required')
    if (nameExists(trimmed)) throw new Error('A category with this name already exists')
    const category = {
      id: generateId(),
      name: trimmed,
      icon: icon || '🏷️',
      color: color || '#4A9498',
      isDefault: false,
      order: state.length,
      createdAt: new Date().toISOString(),
    }
    state.push(category)
    return category
  }

  function updateCategory(id, patch) {
    const cat = findById(id)
    if (!cat) return
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (!trimmed) throw new Error('Category name is required')
      if (nameExists(trimmed, id)) throw new Error('A category with this name already exists')
      cat.name = trimmed
    }
    if (patch.icon !== undefined) cat.icon = patch.icon
    if (patch.color !== undefined) cat.color = patch.color
  }

  function reorder(orderedIds) {
    orderedIds.forEach((id, idx) => {
      const cat = findById(id)
      if (cat) cat.order = idx
    })
  }

  function canDelete(id, expenses) {
    const cat = findById(id)
    if (!cat || cat.isDefault) return false
    return !expenses.some((e) => e.categoryId === id)
  }

  function deleteCategory(id, expenses) {
    if (!canDelete(id, expenses)) {
      throw new Error('Reassign expenses using this category before deleting it')
    }
    const idx = state.findIndex((c) => c.id === id)
    if (idx !== -1) state.splice(idx, 1)
  }

  return {
    categories: state,
    sorted,
    findById,
    getOtherCategory,
    addCategory,
    updateCategory,
    reorder,
    canDelete,
    deleteCategory,
  }
}
