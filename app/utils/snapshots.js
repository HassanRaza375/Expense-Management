import { buildBackup } from './backup.js'

// Automatic safety snapshots, taken before anything that replaces data (import, future migrations).
// Stored in IndexedDB (not localStorage) so they don't compete for the small localStorage quota.
// Snapshots hold app data only: no attachments, no app-lock record.

const DB_NAME = 'hisaab-backups'
const STORE_NAME = 'snapshots'
const DB_VERSION = 1
export const MAX_SNAPSHOTS = 5

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// A connection is opened per operation and closed afterwards, so deleting the database later
// (reset all data) is never blocked by a lingering connection.
async function withStore(mode, fn) {
  const db = await openDB()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const store = tx.objectStore(STORE_NAME)
      let result
      try {
        result = fn(store)
      } catch (err) {
        reject(err)
        return
      }
      tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function saveSnapshot(reason) {
  const backup = await buildBackup({ includeAttachments: false })
  const createdAt = new Date().toISOString()
  const snapshot = { id: `${Date.now()}`, createdAt, reason, counts: backup.counts, backup }
  await withStore('readwrite', (store) => store.put(snapshot))
  await prune()
  return snapshot
}

async function prune() {
  const all = await listSnapshots()
  const extra = all.slice(MAX_SNAPSHOTS)
  if (!extra.length) return
  await withStore('readwrite', (store) => {
    extra.forEach((s) => store.delete(s.id))
  })
}

// Newest first.
export async function listSnapshots() {
  const rows = await withStore('readonly', (store) => store.getAll())
  return (rows || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// Used by "Reset all data": a reset must not leave a readable copy of the data behind.
export function clearSnapshots() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}
