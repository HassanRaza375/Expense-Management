// Minimal in-memory IndexedDB for Node tests (test helper only; nothing in src/ imports it).
// Supports exactly what src/utils/attachments.js and src/utils/snapshots.js use: indexedDB.open / deleteDatabase,
// createObjectStore({keyPath}), transaction(store, mode).objectStore(store).put/get/getAll/delete/clear, tx.oncomplete,
// request.onsuccess/onerror, db.close(). Values are structuredClone()d like the real thing (Blob survives).
export function installFakeIndexedDB() {
  const databases = new Map() // name -> Map(storeName -> { keyPath, data: Map })

  globalThis.indexedDB = {
    open(name) {
      const request = {}
      setTimeout(() => {
        let stores = databases.get(name)
        const isNew = !stores
        if (isNew) {
          stores = new Map()
          databases.set(name, stores)
        }
        const db = {
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore(n, { keyPath }) {
            stores.set(n, { keyPath, data: new Map() })
            return {}
          },
          close() {},
          transaction(storeName) {
            const store = stores.get(storeName)
            const tx = {}
            let pending = 0
            const run = (work) => {
              const req = {}
              pending++
              setTimeout(() => {
                try {
                  req.result = work()
                  req.onsuccess?.({ target: req })
                } catch (err) {
                  req.error = err
                  req.onerror?.({ target: req })
                }
                if (--pending === 0) setTimeout(() => tx.oncomplete?.(), 0)
              }, 0)
              return req
            }
            tx.objectStore = () => ({
              put: (value) => run(() => (store.data.set(value[store.keyPath], structuredClone(value)), value[store.keyPath])),
              get: (key) => run(() => (store.data.has(key) ? structuredClone(store.data.get(key)) : undefined)),
              getAll: () => run(() => [...store.data.values()].map((v) => structuredClone(v))),
              delete: (key) => run(() => void store.data.delete(key)),
              clear: () => run(() => void store.data.clear()),
            })
            return tx
          },
        }
        request.result = db
        if (isNew) request.onupgradeneeded?.({ target: request })
        request.onsuccess?.({ target: request })
      }, 0)
      return request
    },
    deleteDatabase(name) {
      const request = {}
      setTimeout(() => {
        databases.delete(name)
        request.onsuccess?.({})
      }, 0)
      return request
    },
  }
  return { databases }
}
