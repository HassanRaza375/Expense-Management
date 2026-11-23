// The base copies and the sync cursor, in their own IndexedDB `hisaab-sync` (version 1, never touching `hisaab-attachments` or `hisaab-backups`). One store `base`:
//   key `${userId}|${collection}/${id}`  ->  { k, userId, revision, data, deleted }       one row per record the device last synced
//   key `${userId}|__state`              ->  { k, userId, state: true, cursor, lastUpload, lastSyncAt }
// A connection is opened per operation and closed after it, like the other stores, so deleting the database is never blocked. Saves are ONE transaction.
import type { BaseState, BaseStore } from "./engine";
import type { BaseEntry } from "./plan";

export const DB_NAME = "hisaab-sync";
const STORE = "base";
const VERSION = 1;

interface Row {
  k: string;
  userId: string;
  state?: true;
  revision?: number;
  data?: unknown;
  deleted?: boolean;
  cursor?: number;
  lastUpload?: Array<[string, number]>;
  lastSyncAt?: number | null;
}

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(idb: IDBFactory, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | undefined): Promise<T | undefined> {
  const db = await open(idb);
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let req: IDBRequest | undefined;
      try {
        req = fn(tx.objectStore(STORE));
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Deletes the whole sync database (used by "Reset all data": the base copies of a cache that no longer exists must not outlive it). */
export function deleteSyncDatabase(idb: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve) => {
    const req = idb.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export function idbBaseStore(userId: string, idb: IDBFactory = indexedDB): BaseStore {
  const prefix = `${userId}|`;
  const stateKey = `${prefix}__state`;
  return {
    async load(): Promise<BaseState | null> {
      const rows = (await withStore<Row[]>(idb, "readonly", (s) => s.getAll())) ?? [];
      const mine = rows.filter((r) => r.userId === userId);
      const st = mine.find((r) => r.k === stateKey);
      if (!st) return null;
      const base = new Map<string, BaseEntry>();
      for (const r of mine) if (!r.state) base.set(r.k.slice(prefix.length), { revision: r.revision ?? 0, data: (r.data ?? {}) as BaseEntry["data"], ...(r.deleted ? { deleted: true } : {}) });
      return { base, cursor: st.cursor ?? 0, lastUpload: st.lastUpload ?? [], lastSyncAt: st.lastSyncAt ?? null };
    },

    async save(patch) {
      const current = (await withStore<Row | undefined>(idb, "readonly", (s) => s.get(stateKey))) ?? undefined;
      await withStore(idb, "readwrite", (s) => {
        for (const [key, e] of patch.put ?? []) s.put({ k: prefix + key, userId, revision: e.revision, data: e.data, deleted: e.deleted === true } satisfies Row);
        for (const key of patch.del ?? []) s.delete(prefix + key);
        const next: Row = {
          k: stateKey,
          userId,
          state: true,
          cursor: patch.cursor ?? current?.cursor ?? 0,
          lastUpload: patch.lastUpload === undefined ? (current?.lastUpload ?? []) : (patch.lastUpload ?? []),
          lastSyncAt: patch.lastSyncAt ?? current?.lastSyncAt ?? null,
        };
        s.put(next);
        return undefined;
      });
    },

    async clear() {
      const rows = (await withStore<Row[]>(idb, "readonly", (s) => s.getAll())) ?? [];
      const mine = rows.filter((r) => r.userId === userId).map((r) => r.k);
      if (!mine.length) return;
      await withStore(idb, "readwrite", (s) => {
        for (const k of mine) s.delete(k);
        return undefined;
      });
    },
  };
}
