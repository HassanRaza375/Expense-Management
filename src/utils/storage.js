const PREFIX = 'hisaab:'

function fullKey(key) {
  return key.startsWith(PREFIX) ? key : `${PREFIX}${key}`
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
    localStorage.setItem(fullKey(key), JSON.stringify(value))
    return true
  } catch (err) {
    console.error(`hisaab:storage — failed to write "${key}"`, err)
    return false
  }
}

export function remove(key) {
  localStorage.removeItem(fullKey(key))
}

export function getRaw(key) {
  return localStorage.getItem(fullKey(key))
}

export function setRaw(key, rawString) {
  localStorage.setItem(fullKey(key), rawString)
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
  VEHICLE_TAGS: 'vehicleTags',
  META: 'meta',
}
