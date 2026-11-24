import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTERS, ADAPTER_BY_KEY, splitAll, type RecordMap } from "../app/lib/sync/adapters";
import { COLLECTIONS, COLLECTION_BY_NAME } from "../app/lib/sync/collections";
import { DEVICE_ONLY_KEYS, SYNCED_KEYS, classify } from "../app/lib/sync/inventory";
import { deepEqual, mergeData } from "../app/lib/sync/merge";
import { dayKeyOf, planPush, type BaseEntry } from "../app/lib/sync/plan";
import { clone, sampleStorage } from "./helpers/syncData";
// @ts-expect-error plain JS module
import { STORAGE_KEYS } from "../app/utils/storage.js";

const sample = sampleStorage();
const readSample = (k: string) => sample[k];

describe("every collection belongs to exactly one adapter, and every adapter key is a stored key", () => {
  it("the plain-JS list the storage wrapper routes by is exactly the adapters' keys", () => {
    expect([...SYNCED_KEYS].sort()).toEqual(ADAPTERS.map((a) => a.key).sort());
  });
  it("covers all collections once", () => {
    const names = ADAPTERS.flatMap((a) => a.collections);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(COLLECTIONS.map((c) => c.name).sort());
    for (const c of COLLECTIONS) expect(ADAPTER_BY_KEY[c.key]!.collections, c.name).toContain(c.name);
  });
  it("children name a parent that exists, and the parent field they carry", () => {
    for (const c of COLLECTIONS.filter((x) => x.parentField)) {
      expect(c.parent, c.name).toBeTruthy();
      expect(COLLECTION_BY_NAME[c.parent!], c.name).toBeTruthy();
    }
  });
});

describe("split then join gives back exactly what was stored", () => {
  it("for every key of a realistic data set (nested arrays flattened and rebuilt, device-only parts kept)", () => {
    const records = splitAll(readSample);
    for (const a of ADAPTERS) expect(deepEqual(a.join(records, sample[a.key]), sample[a.key]), a.key).toBe(true);
  });
  it("flattens children into their own records with the parent's id, and strips it again", () => {
    const records = splitAll(readSample);
    expect(records.get("fundContribution")!.get("fc1")).toMatchObject({ fundId: "f1", amount: 1000 });
    expect(records.get("fundWithdrawal")!.get("fw1")).toMatchObject({ fundId: "f1" });
    expect(records.get("fundValue")!.get("fv1")).toMatchObject({ fundId: "f1", value: 1500 });
    expect(records.get("repayment")!.get("rp1")).toMatchObject({ loanId: "l1" });
    expect(records.get("goalSaving")!.get("s1")).toMatchObject({ goalId: "g1" });
    expect(records.get("fund")!.get("f1")).not.toHaveProperty("contributions");
    expect(records.get("loan")!.get("l1")).not.toHaveProperty("repayments");
    const joined = ADAPTER_BY_KEY.investments!.join(records, sample.investments) as Array<Record<string, unknown>>;
    expect((joined[0]!.contributions as Array<Record<string, unknown>>)[0]).not.toHaveProperty("fundId");
  });
  it("the device-only parts never become part of a record: bill files and the theme; a receipt is a record of its own, with its expense as parent", () => {
    const records = splitAll(readSample);
    expect(records.get("expense")!.get("e1")).not.toHaveProperty("receipts"); // flattened away
    expect(records.get("receipt")!.get("r1")).toMatchObject({ expenseId: "e1", size: 1000 });
    expect(records.get("bill")!.get("b1")).not.toHaveProperty("attachments");
    expect(records.get("settings")!.get("settings")).not.toHaveProperty("theme");
    expect(JSON.stringify([...records.values()].map((m) => [...m.values()]))).not.toMatch(/bill\.pdf|"dark"/);
  });
  it("unknown fields survive both ways", () => {
    const s = clone(sample);
    (s.expenses as Array<Record<string, unknown>>)[0]!.futureField = { nested: [1, 2] };
    (s.accounts as Record<string, unknown>).futureTopLevel = 7;
    const records = splitAll((k) => s[k]);
    expect(records.get("expense")!.get("e1")).toHaveProperty("futureField");
    expect((ADAPTER_BY_KEY.accounts!.join(records, s.accounts) as Record<string, unknown>).futureTopLevel).toBe(7);
    expect(deepEqual(ADAPTER_BY_KEY.expenses!.join(records, s.expenses), s.expenses)).toBe(true);
  });
  it("an element with no usable id is kept, never dropped", () => {
    const s = clone(sample);
    (s.expenses as unknown[]).push({ amount: 5, note: "no id" }, "not an object", { id: "../bad", amount: 1 });
    const records = splitAll((k) => s[k]);
    expect(records.get("expense")!.size).toBe(3);
    const joined = ADAPTER_BY_KEY.expenses!.join(records, s.expenses) as unknown[];
    expect(joined).toHaveLength(6);
    expect(joined).toContainEqual({ amount: 5, note: "no id" });
  });
  it("an empty or missing value gives no records, and an empty set of records gives empty containers", () => {
    const none = splitAll(() => undefined);
    expect([...none.values()].every((m) => m.size === 0)).toBe(true);
    expect(ADAPTER_BY_KEY.expenses!.join(none, undefined)).toEqual([]);
    expect(ADAPTER_BY_KEY.bills!.join(none, undefined)).toEqual({ connections: [], bills: [] });
    expect(ADAPTER_BY_KEY.accounts!.join(none, undefined)).toEqual({ accounts: [], transfers: [], adjustments: [] });
    expect(ADAPTER_BY_KEY.lending!.join(none, undefined)).toEqual([]);
    expect(ADAPTER_BY_KEY.vault!.join(none, null)).toBeNull();
    expect(ADAPTER_BY_KEY.settings!.join(none, { theme: "light" })).toEqual({ theme: "light" });
  });
  it("a record that arrives from another device gets what the page needs (bill attachments []) and its parent's children", () => {
    const records: RecordMap = new Map([
      ["bill", new Map([["b9", { id: "b9", connectionId: "c1", amount: 1 }]])],
      ["loan", new Map([["l9", { id: "l9", amount: 5 }]])],
      ["repayment", new Map([["r9", { id: "r9", loanId: "l9", amount: 1 }]])],
    ]);
    expect((ADAPTER_BY_KEY.bills!.join(records, undefined) as { bills: unknown[] }).bills).toEqual([{ id: "b9", connectionId: "c1", amount: 1, attachments: [] }]);
    expect(ADAPTER_BY_KEY.lending!.join(records, undefined)).toEqual([{ id: "l9", amount: 5, repayments: [{ id: "r9", amount: 1 }] }]);
  });
  it("the settings keep this device's theme and take everything else from the account", () => {
    const records: RecordMap = new Map([["settings", new Map([["settings", { currencySymbol: "$", cycleResetDay: 15 }]])]]);
    expect(ADAPTER_BY_KEY.settings!.join(records, { theme: "light", currencySymbol: "Rs", cycleResetDay: 1, extra: true })).toEqual({ theme: "light", currencySymbol: "$", cycleResetDay: 15, extra: true });
  });
  it("order: this device's records first, then new ones in arrival order", () => {
    const records: RecordMap = new Map([["expense", new Map([["e2", { id: "e2", amount: 2 }], ["e1", { id: "e1", amount: 1 }], ["e9", { id: "e9", amount: 9 }]])]]);
    const joined = ADAPTER_BY_KEY.expenses!.join(records, [{ id: "e2" }, { id: "e1" }]) as Array<{ id: string }>;
    expect(joined.map((e) => e.id)).toEqual(["e2", "e1", "e9"]);
  });
});

describe("merge (three-way, field by field)", () => {
  const base = { a: 1, b: 1, c: 1, d: 1 };
  it("a field changed on one side only takes that side's value", () => {
    const m = mergeData(base, { a: 2, b: 1, c: 1, d: 1 }, { a: 1, b: 5, c: 1, d: 1 });
    expect(m.data).toEqual({ a: 2, b: 5, c: 1, d: 1 });
    expect(m.conflicts).toEqual([]);
  });
  it("a field changed to different values on both sides: the local value wins and the conflict is named", () => {
    const m = mergeData(base, { ...base, a: 2 }, { ...base, a: 3 });
    expect(m.data.a).toBe(2);
    expect(m.conflicts).toEqual(["a"]);
  });
  it("both changed it to the same value: no conflict", () => {
    expect(mergeData(base, { ...base, a: 2 }, { ...base, a: 2 }).conflicts).toEqual([]);
  });
  it("added and removed fields", () => {
    expect(mergeData({ a: 1 }, { a: 1, n: "local" }, { a: 1, m: "remote" }).data).toEqual({ a: 1, n: "local", m: "remote" });
    expect(mergeData({ a: 1, gone: 1 }, { a: 1 }, { a: 1, gone: 1 }).data).toEqual({ a: 1 }); // removed here, untouched there
    expect(mergeData({ a: 1, gone: 1 }, { a: 1, gone: 1 }, { a: 1 }).data).toEqual({ a: 1 }); // removed there, untouched here
  });
  it("with no base the local value wins where they differ and the account's extra fields stay", () => {
    const m = mergeData(null, { a: "mine", only: 1 }, { a: "theirs", extra: 2 });
    expect(m.data).toEqual({ a: "mine", only: 1, extra: 2 });
  });
  it("nested values are compared whole, in any key order", () => {
    expect(deepEqual({ x: { a: 1, b: [1, { c: 2 }] } }, { x: { b: [1, { c: 2 }], a: 1 } })).toBe(true);
    expect(deepEqual({ x: [1, 2] }, { x: [2, 1] })).toBe(false);
    expect(deepEqual({ a: undefined }, {})).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

describe("planPush: what to send", () => {
  const entries = (records: RecordMap, revision = 1): Map<string, BaseEntry> => new Map([...records].flatMap(([c, m]) => [...m].map(([id, data]) => [`${c}/${id}`, { revision, data: clone(data) } as BaseEntry])));

  it("nothing changed since the last sync: nothing to send", () => {
    const local = splitAll(readSample);
    expect(planPush(local, entries(local))).toEqual([]);
  });
  it("a new record is a put from revision 0; a changed one is a put from its base revision; a removed one is a delete", () => {
    const local = splitAll(readSample);
    const base = entries(local, 7);
    local.get("expense")!.set("new", { id: "new", date: "2026-11-20T07:00:00.000Z", amount: 5, categoryId: "cat-food" });
    (local.get("expense")!.get("e2") as Record<string, unknown>).amount = 200;
    local.get("expense")!.delete("e3");
    const ops = planPush(local, base);
    expect(ops.map((o) => [o.collection, o.id, o.base, o.delete ? "delete" : "put"])).toEqual([
      ["expense", "e2", 7, "put"],
      ["expense", "new", 0, "put"],
      ["expense", "e3", 7, "delete"],
    ]);
  });
  it("puts come before deletes, and the order is the same every time", () => {
    const local = splitAll(readSample);
    const base = entries(local);
    local.get("income")!.delete("i1");
    local.get("asset")!.get("as1")!.name = "Changed";
    const a = planPush(local, base);
    expect(a.map((o) => (o.delete ? "delete" : "put"))).toEqual(["put", "delete"]);
    expect(planPush(local, base)).toEqual(a);
  });
  it("a record the server holds as deleted that is back on this device is sent as a put over the tombstone's revision (Undo)", () => {
    const local = splitAll(readSample);
    const base = new Map<string, BaseEntry>([["expense/e1", { revision: 9, data: {}, deleted: true }]]);
    const ops = planPush(new Map([["expense", new Map([["e1", local.get("expense")!.get("e1")!]])]]), base);
    expect(ops).toEqual([expect.objectContaining({ collection: "expense", id: "e1", base: 9 })]);
    expect(ops[0]!.delete).toBeUndefined();
  });
  it("a tombstone in the base is never deleted again", () => {
    const base = new Map<string, BaseEntry>([["expense/gone", { revision: 4, data: {}, deleted: true }]]);
    expect(planPush(new Map(), base)).toEqual([]);
  });
  it("attaches the local day of each dated record, and never a key for an undated one", () => {
    const local = splitAll(readSample);
    const ops = planPush(local, new Map());
    const byId = (c: string, id: string) => ops.find((o) => o.collection === c && o.id === id)!;
    expect(byId("goal", "g1").dayKey).toBe("2026-11-01"); // a stored day key is used as it is
    expect(byId("account", "acc1").dayKey).toBe("2026-10-01");
    expect(byId("category", "cat-food").dayKey).toBeNull(); // no day field at all
    expect(byId("expense", "e2").dayKey).toMatch(/^2026-11-1[789]$/); // the local day of the timestamp
  });
});

describe("dayKeyOf follows the app's local-day rule (never UTC)", () => {
  const spec = COLLECTION_BY_NAME.expense!;
  it("a local-noon timestamp is that local day in every zone", () => {
    const noon = new Date(2026, 10, 20, 12, 0, 0).toISOString(); // local noon on the 20th, whatever the zone
    expect(dayKeyOf(spec, { date: noon })).toBe("2026-11-20");
  });
  it("a plain day key is kept as it is, and bad or missing values give null", () => {
    expect(dayKeyOf(spec, { date: "2026-11-20" })).toBe("2026-11-20");
    for (const date of [undefined, null, "", "not a date", NaN, {}]) expect(dayKeyOf(spec, { date }), String(date)).toBeNull();
    expect(dayKeyOf(COLLECTION_BY_NAME.category!, { date: "2026-11-20" })).toBeNull();
  });
});

describe("every stored key is classified (D18)", () => {
  it("each key the app names is either synced or device-only", () => {
    for (const key of Object.values(STORAGE_KEYS) as string[]) expect(classify(key), key).not.toBe("unknown");
  });

  it("each key a source file reads or writes through the storage wrapper is classified", () => {
    const root = fileURLToPath(new URL("../app", import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : /\.(js|ts|vue)$/.test(n) ? [path.join(dir, n)] : []));
    const found = new Map<string, string>();
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      // get('key', ...), set('key', ...), remove('key'), getRaw('key'), setRaw('key', ...) with a string literal key (a constant is covered by STORAGE_KEYS above)
      for (const m of src.matchAll(/\b(?:get|set|remove|getRaw|setRaw)\(\s*['"]([A-Za-z][A-Za-z0-9:_-]*)['"]\s*[,)]/g)) found.set(m[1]!, path.relative(root, file));
      for (const m of src.matchAll(/['"`]hisaab:([A-Za-z][A-Za-z0-9:_-]*)['"`]/g)) found.set(m[1]!, path.relative(root, file)); // a quoted key such as 'hisaab:meta'
    }
    expect(found.size).toBeGreaterThan(3);
    for (const [key, file] of found) {
      expect(classify(key), `${key} (used in ${file}) is neither synced nor device-only: classify it in app/lib/sync/inventory.ts`).not.toBe("unknown");
    }
  });

  it("the app lock, the data version and the layout never sync; the vault only as ciphertext (an opaque record)", () => {
    for (const k of ["applock", "meta", "ui:sidebarOpen", "auth:hint", "corrupt:expenses", "u:abc:expenses", "sync:ready"]) expect(classify(k), k).toBe("device-only");
    expect(SYNCED_KEYS).not.toContain("applock");
    expect(SYNCED_KEYS).not.toContain("meta");
    expect(SYNCED_KEYS).toContain("vault");
    expect(Object.keys(DEVICE_ONLY_KEYS)).toEqual(expect.arrayContaining(["applock", "meta"]));
    expect(classify("somethingNew")).toBe("unknown");
    expect(classify("hisaab:expenses")).toBe("synced");
  });
});
