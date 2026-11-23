// What to send: the difference between this device's records and the base (the records as of the last successful sync). Pure.
// A record that is new or changed is a `put`; a record in the base that is gone from the device is a `delete` (a tombstone on the server).
import { localDayKey } from "../../utils/reporting.js";
import { COLLECTION_BY_NAME, recordKey, type CollectionSpec } from "./collections";
import type { RecordMap } from "./adapters";
import { deepEqual, type Data } from "./merge";
import { isRealDayKey } from "../dayKey";

/** What the device remembers about a record from the last sync. A tombstone entry means the server holds the record as deleted at that revision. */
export interface BaseEntry {
  revision: number;
  data: Data;
  deleted?: boolean;
}

export interface PushOp {
  collection: string;
  id: string;
  /** the revision this device last saw of the record (0 = never) */
  base: number;
  /** the record, or absent for a delete */
  put?: Data;
  delete?: true;
  /** the local day of the record, computed here with the app's own rule (the server only validates its form) */
  dayKey?: string | null;
}

const DAY_KEY_FORM = /^\d{4}-\d{2}-\d{2}$/;

/** The `dayKey` of a record: a stored `YYYY-MM-DD` as it is, anything else through the app's `localDayKey` (the local day, never UTC). Null when there is no date. */
export function dayKeyOf(spec: CollectionSpec, data: Data): string | null {
  if (!spec.dayField) return null;
  const v = data[spec.dayField];
  if (v === undefined || v === null || v === "") return null;
  const key = typeof v === "string" && DAY_KEY_FORM.test(v) ? v : (localDayKey(v as string | Date) as string | null);
  return key && isRealDayKey(key) ? key : null;
}

export const baseKeyOf = recordKey;

/** The operations that bring the server to this device's state. Deterministic order: puts then deletes, by key. */
export function planPush(local: RecordMap, base: Map<string, BaseEntry>): PushOp[] {
  const puts: PushOp[] = [];
  const seen = new Set<string>();
  for (const [collection, records] of local) {
    const spec = COLLECTION_BY_NAME[collection];
    if (!spec) continue;
    for (const [id, data] of records) {
      const key = recordKey(collection, id);
      seen.add(key);
      const b = base.get(key);
      if (b && !b.deleted && deepEqual(b.data, data)) continue; // unchanged since the last sync
      puts.push({ collection, id, base: b?.revision ?? 0, put: data, dayKey: dayKeyOf(spec, data) });
    }
  }
  const deletes: PushOp[] = [];
  for (const [key, b] of base) {
    if (seen.has(key) || b.deleted) continue; // present on the device, or already a tombstone on the server
    const i = key.indexOf("/");
    deletes.push({ collection: key.slice(0, i), id: key.slice(i + 1), base: b.revision, delete: true });
  }
  const order = (a: PushOp, b: PushOp) => (a.collection + "/" + a.id).localeCompare(b.collection + "/" + b.id);
  return [...puts.sort(order), ...deletes.sort(order)];
}
