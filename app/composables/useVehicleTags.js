import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS, registerState } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

export const DEFAULT_MAINTENANCE_TAG_ID = 'tag-maintenance'

const defaultTags = [{ id: DEFAULT_MAINTENANCE_TAG_ID, name: 'Maintenance', icon: '🔧', color: '#4A9498', createdAt: new Date().toISOString() }]

function loadInitial() {
  const stored = get(STORAGE_KEYS.VEHICLE_TAGS, null)
  if (stored && stored.length) return stored
  return defaultTags
}

const state = reactive(loadInitial())

// lets a change that arrives from the account (account mode) reach this state without a reload
registerState(STORAGE_KEYS.VEHICLE_TAGS, state)

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.VEHICLE_TAGS, val)
  },
  { deep: true }
)

export function useVehicleTags() {
  function findById(id) {
    return state.find((t) => t.id === id)
  }

  function nameExists(name, excludeId = null) {
    const lower = name.trim().toLowerCase()
    return state.some((t) => t.id !== excludeId && t.name.trim().toLowerCase() === lower)
  }

  function addTag({ name, icon, color }) {
    const trimmed = (name || '').trim()
    if (!trimmed) throw new Error('Tag name is required')
    if (nameExists(trimmed)) throw new Error('A tag with this name already exists')
    const tag = {
      id: generateId(),
      name: trimmed,
      icon: icon || '🏷️',
      color: color || '#4A9498',
      createdAt: new Date().toISOString(),
    }
    state.push(tag)
    return tag
  }

  function updateTag(id, patch) {
    const tag = findById(id)
    if (!tag) return
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (!trimmed) throw new Error('Tag name is required')
      if (nameExists(trimmed, id)) throw new Error('A tag with this name already exists')
      tag.name = trimmed
    }
    if (patch.icon !== undefined) tag.icon = patch.icon
    if (patch.color !== undefined) tag.color = patch.color
  }

  function canDelete(id, logs) {
    return !logs.some((l) => l.tagId === id)
  }

  function deleteTag(id, logs) {
    if (!canDelete(id, logs)) {
      throw new Error('Reassign or delete the log entries using this tag before deleting it')
    }
    const idx = state.findIndex((t) => t.id === id)
    if (idx !== -1) state.splice(idx, 1)
  }

  return {
    tags: state,
    findById,
    addTag,
    updateTag,
    canDelete,
    deleteTag,
  }
}
