import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const state = reactive(get(STORAGE_KEYS.METER_READINGS, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.METER_READINGS, val)
  },
  { deep: true }
)

let pendingUndo = null

export function useMeterReadings() {
  function findById(id) {
    return state.find((r) => r.id === id)
  }

  function readingsForConnection(connectionId) {
    return state
      .filter((r) => r.connectionId === connectionId)
      .sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt))
  }

  // Most recent reading for a connection, optionally excluding one linked to a specific bill
  // (used while computing a bill's own "previous reading" so it never sees itself).
  function latestReadingExcluding(connectionId, excludeBillId = null) {
    const list = state
      .filter((r) => r.connectionId === connectionId && (excludeBillId == null || r.billId !== excludeBillId))
      .sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt))
    return list[0] || null
  }

  function latestReading(connectionId) {
    return latestReadingExcluding(connectionId)
  }

  function addReading({ connectionId, date, reading, notes, source, billId }) {
    if (!connectionId) throw new Error('Meter is required')
    const val = Number(reading)
    if (!(val >= 0)) throw new Error('Reading must be 0 or greater')
    const entry = {
      id: generateId(),
      connectionId,
      date: date || new Date().toISOString(),
      reading: val,
      notes: notes || '',
      source: source === 'bill' ? 'bill' : 'manual',
      billId: source === 'bill' ? billId ?? null : null,
      createdAt: new Date().toISOString(),
    }
    state.push(entry)
    return entry
  }

  function updateReading(id, patch) {
    const entry = findById(id)
    if (!entry) return
    if (entry.source === 'bill') {
      throw new Error('This reading came from a bill — edit that bill instead')
    }
    if (patch.date !== undefined) entry.date = patch.date
    if (patch.reading !== undefined) {
      const val = Number(patch.reading)
      if (!(val >= 0)) throw new Error('Reading must be 0 or greater')
      entry.reading = val
    }
    if (patch.notes !== undefined) entry.notes = patch.notes
  }

  // Upsert the reading tied to a specific bill (called whenever a bill's meter reading is saved/edited).
  function syncFromBill(bill) {
    if (bill.currentReading == null) return
    const existing = state.find((r) => r.billId === bill.id)
    const date = bill.issueDate || bill.dueDate || new Date().toISOString()
    if (existing) {
      existing.date = date
      existing.reading = bill.currentReading
    } else {
      addReading({ connectionId: bill.connectionId, date, reading: bill.currentReading, source: 'bill', billId: bill.id })
    }
  }

  // Returns the removed readings so a deleted bill can be restored with them.
  function removeByBillId(billId) {
    const idx = state.findIndex((r) => r.billId === billId)
    return idx !== -1 ? state.splice(idx, 1) : []
  }

  function restoreReadings(entries) {
    const present = new Set(state.map((r) => r.id))
    for (const entry of entries || []) {
      if (!present.has(entry.id)) state.push(entry)
    }
  }

  function deleteReading(id) {
    const entry = findById(id)
    if (!entry) return null
    if (entry.source === 'bill') {
      throw new Error('This reading came from a bill — edit or delete that bill instead')
    }
    const idx = state.findIndex((r) => r.id === id)
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

  // Chronological history with the unit delta vs the prior reading.
  function history(connectionId) {
    const sorted = state
      .filter((r) => r.connectionId === connectionId)
      .sort((a, b) => new Date(a.date) - new Date(b.date) || new Date(a.createdAt) - new Date(b.createdAt))
    return sorted.map((entry, idx) => ({
      ...entry,
      unitsUsed: idx > 0 ? entry.reading - sorted[idx - 1].reading : null,
    }))
  }

  function unitsSinceLast(connectionId) {
    const h = history(connectionId)
    if (!h.length) return null
    return h[h.length - 1].unitsUsed
  }

  function averagePerReading(connectionId) {
    const h = history(connectionId).filter((r) => r.unitsUsed != null)
    if (!h.length) return 0
    return h.reduce((sum, r) => sum + r.unitsUsed, 0) / h.length
  }

  return {
    readings: state,
    findById,
    readingsForConnection,
    latestReading,
    latestReadingExcluding,
    addReading,
    updateReading,
    syncFromBill,
    removeByBillId,
    restoreReadings,
    deleteReading,
    undoDelete,
    history,
    unitsSinceLast,
    averagePerReading,
  }
}
