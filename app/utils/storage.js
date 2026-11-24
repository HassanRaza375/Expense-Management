import { SYNCED_KEYS } from './syncedKeys.js'

const PREFIX = 'hisaab:'

// ---- account mode (D9, D10) ----
// Guest mode (the default, and always when accounts are off) reads and writes `hisaab:<key>` exactly as before. Once `useUserCache(userId)` has been called (by the
// startup, before any composable loads) the SYNCED keys are routed to `hisaab:u:<userId>:<key>`, a per-user cache; device-only keys (the app lock, the data version,
// the layout) are never routed. Composables call the same get/set and know nothing about it.
const SYNCED = new Set(SYNCED_KEYS)
let cachePrefix = null
const changeListeners = new Set()
const live = new Map() // bare key -> { state, apply }: the live state of the composable that owns the key

export function useUserCache(userId) {
  cachePrefix = userId ? `${PREFIX}u:${userId}:` : null
}

export function isUserCacheActive() {
  return cachePrefix !== null
}

/** Called with the bare key after a synced key was changed in account mode. The sync engine listens to schedule a run. */
export function onStorageChange(callback) {
  changeListeners.add(callback)
  return () => changeListeners.delete(callback)
}

/**
 * A composable tells the wrapper where its live state is, so a change that arrives from the account can be put into the page without a reload.
 * `apply(value)` replaces the default behaviour (arrays are replaced in place, objects get the new fields assigned).
 */
export function registerState(key, state, apply) {
  live.set(bare(key), { state, apply })
}

/** Puts a value into the live state of the key's composable (does nothing when none is registered). */
export function applyToLive(key, value) {
  const entry = live.get(bare(key))
  if (!entry) return
  if (entry.apply) return entry.apply(value)
  const { state } = entry
  if (Array.isArray(state)) state.splice(0, state.length, ...(Array.isArray(value) ? value : []))
  else if (state && typeof state === 'object' && value && typeof value === 'object') Object.assign(state, value)
}

function bare(key) {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
}

function routed(key) {
  return cachePrefix !== null && SYNCED.has(bare(key))
}

function fullKey(key) {
  if (cachePrefix !== null && SYNCED.has(bare(key))) return `${cachePrefix}${bare(key)}`
  return key.startsWith(PREFIX) ? key : `${PREFIX}${key}`
}

// the same data whatever the order of the keys (the page's live state may list the fields of an object in another order than the value that was stored)
function canonical(json) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v)
  return JSON.stringify(sort(JSON.parse(json)))
}

function changed(key) {
  for (const cb of changeListeners) {
    try {
      cb(bare(key))
    } catch {
      // a listener must never break a write
    }
  }
}

export function get(key, fallback) {
  const raw = localStorage.getItem(fullKey(key))
  if (raw === null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    // The caller's state will later overwrite this key with the fallback. Keep the unreadable
    // original under a separate key (once) so it can still be recovered by hand.
    preserveCorrupt(key, raw)
    console.warn(`hisaab:storage — corrupt data for "${key}", using default (original kept under "${CORRUPT_PREFIX}${key}")`)
    return fallback
  }
}

const CORRUPT_PREFIX = `${PREFIX}corrupt:`

function preserveCorrupt(key, raw) {
  try {
    const backupKey = `${CORRUPT_PREFIX}${key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key}`
    if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, raw)
  } catch {
    // storage full or unavailable — nothing more we can do
  }
}

// Returns true when the value was written, false when the write failed (e.g. quota exceeded).
export function set(key, value) {
  try {
    const physical = fullKey(key)
    const json = JSON.stringify(value)
    if (routed(key)) {
      // account mode: an identical value is not a change (the composable writes back what the sync just put in)
      const previous = localStorage.getItem(physical)
      if (previous === json || (previous !== null && canonical(previous) === canonical(json))) return true
      localStorage.setItem(physical, json)
      changed(key)
      return true
    }
    localStorage.setItem(physical, json)
    return true
  } catch (err) {
    console.error(`hisaab:storage — failed to write "${key}"`, err)
    return false
  }
}

export function remove(key) {
  localStorage.removeItem(fullKey(key))
  if (routed(key)) changed(key)
}

export function getRaw(key) {
  return localStorage.getItem(fullKey(key))
}

export function setRaw(key, rawString) {
  localStorage.setItem(fullKey(key), rawString)
  if (routed(key)) changed(key)
}

export function usageBytes() {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(PREFIX)) {
      total += k.length + (localStorage.getItem(k) || '').length
    }
  }
  return total * 2 // UTF-16 code units, rough approximation in bytes
}

export function ensureMeta() {
  const meta = get('meta', null)
  if (!meta) {
    set('meta', { version: 1 })
  }
  return get('meta', { version: 1 })
}

export const STORAGE_KEYS = {
  APPLOCK: 'applock',
  SETTINGS: 'settings',
  CATEGORIES: 'categories',
  EXPENSES: 'expenses',
  RECURRING: 'recurring',
  VAULT: 'vault',
  ASSETS: 'assets',
  BILLS: 'bills',
  VEHICLES: 'vehicles',
  VEHICLE_LOGS: 'vehicleLogs',
  FUEL_LOGS: 'fuelLogs',
  INCOME: 'income',
  LENDING: 'lending',
  METER_READINGS: 'meterReadings',
  INVESTMENTS: 'investments',
  ACCOUNTS: 'accounts', // { accounts: [], transfers: [], adjustments: [] }  (Phase 2)
  VEHICLE_TAGS: 'vehicleTags',
  GOALS: 'goals', // [ { id, name, targetAmount, ... } ]  (Phase 5)
  META: 'meta',
}
