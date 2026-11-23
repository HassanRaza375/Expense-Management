// Adapters: the app's stored values (one JSON value per localStorage key) to flat sync records and back (D12, docs/NUXT_PLAN.md section 5).
//
//   split(value)            the value of one key -> its records (nested children flattened, each with its parent's id)
//   join(records, current)  the records of that key -> the value to store. `current` is what is stored now: the device-only parts of a record (receipts, bill
//                           attachments, the theme) are carried over from it, and anything in it that cannot be synced (an element with no usable id) is kept.
//
// They read the WHOLE stored value and write the WHOLE value back, so fields this code has never heard of survive, and today's shapes stay exactly as they are.
import { ID_RE, SINGLETON_ID, type SyncRecord } from "./collections";
import { clone, type Data } from "./merge";

/** collection -> id -> data: the records of one or more keys, in order (a Map keeps insertion order: this device's order first, then new records as they arrive). */
export type RecordMap = Map<string, Map<string, Data>>;

export interface Adapter {
  key: string;
  collections: string[];
  /** the stored value when nothing is stored (used to compare and to start) */
  split(value: unknown): SyncRecord[];
  join(records: RecordMap, current: unknown): unknown;
}

const isObj = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);
export const validId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const byCollection = (records: RecordMap, c: string): Map<string, Data> => records.get(c) ?? new Map();

/** `data` without the named fields (device-only or flattened away) */
function without(obj: Data, fields: string[]): Data {
  const drop = new Set(fields);
  return clone(Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.has(k))));
}

/** records of a plain array of objects with ids */
function recordsOf(collection: string, value: unknown, strip: string[] = []): SyncRecord[] {
  const out: SyncRecord[] = [];
  for (const el of arr(value)) if (isObj(el) && validId(el.id)) out.push({ collection, id: el.id, data: without(el, strip) });
  return out;
}

/** the elements of `current` an adapter cannot sync (no usable id): they are kept, never dropped */
const orphansOf = (current: unknown): unknown[] => arr(current).filter((el) => !(isObj(el) && validId(el.id)));

const indexById = (list: unknown[]): Map<string, Data> => new Map(list.filter((e): e is Data => isObj(e) && validId(e.id)).map((e) => [e.id as string, e]));

/**
 * The array of one collection: records in map order, each with the device-only fields it had on this device, plus the unsyncable elements.
 * `defaults` fills a field the UI relies on when a record arrives from another device without it.
 */
function arrayOf(records: Map<string, Data>, current: unknown, deviceOnly: string[] = [], defaults: Data = {}): unknown[] {
  const local = indexById(arr(current));
  const out: unknown[] = [];
  for (const [id, data] of records) {
    const item: Data = { ...clone(data) };
    const mine = local.get(id);
    for (const f of deviceOnly) if (mine && mine[f] !== undefined) item[f] = clone(mine[f]);
    for (const [f, v] of Object.entries(defaults)) if (item[f] === undefined) item[f] = clone(v);
    out.push(item);
  }
  return [...out, ...orphansOf(current)];
}

/** a flat array stored under one key, one collection */
function flat(key: string, collection: string, opts: { deviceOnly?: string[]; defaults?: Data } = {}): Adapter {
  return {
    key,
    collections: [collection],
    split: (value) => recordsOf(collection, value, opts.deviceOnly),
    join: (records, current) => arrayOf(byCollection(records, collection), current, opts.deviceOnly, opts.defaults),
  };
}

/** an array of parents whose nested arrays become child collections: `children` = [childCollection, fieldInParent, parentIdField] */
function nested(key: string, parent: string, children: Array<[collection: string, field: string, parentField: string]>, optional: string[] = []): Adapter {
  const fields = children.map((c) => c[1]);
  return {
    key,
    collections: [parent, ...children.map((c) => c[0])],
    split(value) {
      const out: SyncRecord[] = [];
      for (const p of arr(value)) {
        if (!isObj(p) || !validId(p.id)) continue;
        out.push({ collection: parent, id: p.id, data: without(p, fields) });
        for (const [collection, field, parentField] of children) {
          for (const c of arr(p[field])) if (isObj(c) && validId(c.id)) out.push({ collection, id: c.id, data: { ...clone(c), [parentField]: p.id } });
        }
      }
      return out;
    },
    join(records, current) {
      const parents = byCollection(records, parent);
      const kids = children.map(([collection, field, parentField]) => ({ field, parentField, list: [...byCollection(records, collection).values()] }));
      const base = arrayOf(parents, current);
      return base.map((p) => {
        if (!isObj(p) || !validId(p.id)) return p;
        const item: Data = { ...p };
        for (const k of kids) {
          const items = k.list.filter((c) => c[k.parentField] === p.id).map((c) => without(c, [k.parentField]));
          if (items.length || !optional.includes(k.field)) item[k.field] = items; // an optional list (receipts) is absent when empty, exactly as the app stores it
        }
        return item;
      });
    },
  };
}

/** an object holding several arrays (`{ connections, bills }`, `{ accounts, transfers, adjustments }`) */
function multi(key: string, parts: Array<{ field: string; collection: string; deviceOnly?: string[]; defaults?: Data }>): Adapter {
  return {
    key,
    collections: parts.map((p) => p.collection),
    split: (value) => parts.flatMap((p) => recordsOf(p.collection, isObj(value) ? value[p.field] : [], p.deviceOnly)),
    join(records, current) {
      const cur = isObj(current) ? current : {};
      const out: Data = { ...cur };
      for (const p of parts) out[p.field] = arrayOf(byCollection(records, p.collection), cur[p.field], p.deviceOnly, p.defaults);
      return out;
    },
  };
}

const settings: Adapter = {
  key: "settings",
  collections: ["settings"],
  split: (value) => (isObj(value) ? [{ collection: "settings", id: SINGLETON_ID.settings!, data: without(value, ["theme"]) }] : []),
  join(records, current) {
    const rec = byCollection(records, "settings").get(SINGLETON_ID.settings!);
    if (!rec) return current;
    const cur = isObj(current) ? current : {};
    const out: Data = { ...cur, ...clone(rec) }; // fields the server does not have stay as they are
    if (cur.theme !== undefined) out.theme = cur.theme; // the theme is this device's own (D14)
    return out;
  },
};

const vault: Adapter = {
  key: "vault",
  collections: ["vault"],
  split: (value) => (isObj(value) ? [{ collection: "vault", id: SINGLETON_ID.vault!, data: clone(value) }] : []),
  join(records, current) {
    const rec = byCollection(records, "vault").get(SINGLETON_ID.vault!);
    return rec ? clone(rec) : current;
  },
};

export const ADAPTERS: Adapter[] = [
  settings,
  flat("categories", "category"),
  // an expense's receipts are their own records (the files are on Cloudinary); the list is absent when empty, as the app stores it
  nested("expenses", "expense", [["receipt", "receipts", "expenseId"]], ["receipts"]),
  flat("income", "income"),
  flat("recurring", "recurring"),
  multi("bills", [
    { field: "connections", collection: "billConnection" },
    { field: "bills", collection: "bill", deviceOnly: ["attachments"], defaults: { attachments: [] } }, // bill files stay on the device; the page expects the array
  ]),
  flat("meterReadings", "meterReading"),
  flat("assets", "asset"),
  nested("lending", "loan", [["repayment", "repayments", "loanId"]]),
  nested("investments", "fund", [
    ["fundContribution", "contributions", "fundId"],
    ["fundWithdrawal", "withdrawals", "fundId"],
    ["fundValue", "valueEntries", "fundId"],
  ]),
  multi("accounts", [
    { field: "accounts", collection: "account" },
    { field: "transfers", collection: "transfer" },
    { field: "adjustments", collection: "correction" },
  ]),
  flat("vehicles", "vehicle"),
  flat("vehicleLogs", "vehicleLog"),
  flat("fuelLogs", "fuelLog"),
  flat("vehicleTags", "vehicleTag"),
  nested("goals", "goal", [["goalSaving", "savings", "goalId"]]),
  vault,
];

export const ADAPTER_BY_KEY: Record<string, Adapter> = Object.fromEntries(ADAPTERS.map((a) => [a.key, a]));
export const ADAPTER_BY_COLLECTION: Record<string, Adapter> = Object.fromEntries(ADAPTERS.flatMap((a) => a.collections.map((c) => [c, a])));

/** The records of every synced key, from a function that reads a stored value. */
export function splitAll(read: (key: string) => unknown): RecordMap {
  const map: RecordMap = new Map();
  for (const a of ADAPTERS) {
    for (const c of a.collections) if (!map.has(c)) map.set(c, new Map());
    for (const r of a.split(read(a.key))) map.get(r.collection)!.set(r.id, r.data);
  }
  return map;
}
