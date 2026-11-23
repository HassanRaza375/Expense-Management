import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS modules
import * as storage from "../app/utils/storage.js";
// @ts-expect-error plain JS module
import { installFakeIndexedDB } from "../scripts/fake-indexeddb.mjs";
import { DB_NAME, deleteSyncDatabase, idbBaseStore } from "../app/lib/sync/baseStore";
import { httpSyncApi, toSyncError } from "../app/lib/sync/client";
import { SyncApiError } from "../app/lib/sync/engine";
import { ApiError } from "../app/lib/account/api";
import { activateIfSignedIn, clearHint, clearUserCache, guestRecordCount, isReady, markReady, readHint, readyKey, userKey, writeHint } from "../app/lib/sync/mode";
import { userLocalStore } from "../app/lib/sync/localStore";
import { SYNC_SCHEMA_VERSION } from "../app/lib/sync/collections";
import { sampleStorage } from "./helpers/syncData";

/** A localStorage that behaves like the browser's (string values, insertion-ordered keys). */
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  dump() {
    return Object.fromEntries(this.m);
  }
}

let ls: MemoryStorage;
beforeEach(() => {
  ls = new MemoryStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = ls as unknown as Storage;
  storage.useUserCache(null);
});
afterEach(() => storage.useUserCache(null));

describe("guest mode is the storage as it always was", () => {
  it("reads and writes hisaab:<key> and tells nobody", () => {
    const seen: string[] = [];
    const off = storage.onStorageChange((k: string) => seen.push(k));
    expect(storage.set("expenses", [{ id: "e1" }])).toBe(true);
    expect(ls.dump()).toEqual({ "hisaab:expenses": '[{"id":"e1"}]' });
    expect(storage.get("expenses", [])).toEqual([{ id: "e1" }]);
    expect(storage.getRaw("expenses")).toBe('[{"id":"e1"}]');
    storage.remove("expenses");
    expect(ls.dump()).toEqual({});
    expect(seen).toEqual([]);
    expect(storage.isUserCacheActive()).toBe(false);
    off();
  });
  it("writes even an unchanged value (as before), and keeps a corrupt value under its own key", () => {
    storage.set("income", []);
    ls.setItem("hisaab:income", "{not json");
    expect(storage.get("income", [])).toEqual([]);
    expect(ls.getItem("hisaab:corrupt:income")).toBe("{not json");
  });
});

describe("account mode routes the synced keys to the user's cache", () => {
  it("synced keys go to hisaab:u:<id>:<key>; the guest value is never touched; device-only keys stay where they were", () => {
    storage.set("expenses", [{ id: "guest" }]);
    storage.set("meta", { version: 3 });
    storage.set("applock", { passwordHash: "h" });
    storage.set("ui:sidebarOpen", true);
    storage.useUserCache("u1");
    expect(storage.isUserCacheActive()).toBe(true);
    expect(storage.get("expenses", [])).toEqual([]); // the account's own data, not the guest's
    storage.set("expenses", [{ id: "mine" }]);
    storage.set("meta", { version: 3, extra: true });
    storage.set("applock", { passwordHash: "h2" });
    const d = ls.dump();
    expect(d["hisaab:expenses"]).toBe('[{"id":"guest"}]'); // untouched
    expect(d["hisaab:u:u1:expenses"]).toBe('[{"id":"mine"}]');
    expect(d["hisaab:meta"]).toContain("extra"); // device-only: not routed
    expect(d["hisaab:applock"]).toContain("h2");
    expect(d["hisaab:ui:sidebarOpen"]).toBe("true");
    expect(Object.keys(d).filter((k) => k.startsWith("hisaab:u:"))).toEqual(["hisaab:u:u1:expenses"]);
  });

  it("every synced key is routed and every device-only key is not", async () => {
    const { SYNCED_KEYS, DEVICE_ONLY_KEYS } = await import("../app/lib/sync/inventory");
    storage.useUserCache("u1");
    for (const k of SYNCED_KEYS) storage.set(k, { k });
    for (const k of Object.keys(DEVICE_ONLY_KEYS)) storage.set(k, { k });
    for (const k of SYNCED_KEYS) expect(ls.getItem(`hisaab:u:u1:${k}`), k).not.toBeNull();
    for (const k of Object.keys(DEVICE_ONLY_KEYS)) {
      expect(ls.getItem(`hisaab:u:u1:${k}`), k).toBeNull();
      expect(ls.getItem(`hisaab:${k}`), k).not.toBeNull();
    }
  });

  it("two users on one device never see each other's cache", () => {
    storage.useUserCache("a");
    storage.set("income", [{ id: "a1" }]);
    storage.useUserCache("b");
    expect(storage.get("income", [])).toEqual([]);
    storage.set("income", [{ id: "b1" }]);
    storage.useUserCache("a");
    expect(storage.get("income", [])).toEqual([{ id: "a1" }]);
    storage.useUserCache(null);
    expect(storage.get("income", [])).toEqual([]); // and the guest has none
  });

  it("a change is announced once; an identical value (even with its fields in another order) is not a change", () => {
    storage.useUserCache("u1");
    const seen: string[] = [];
    storage.onStorageChange((k: string) => seen.push(k));
    storage.set("settings", { a: 1, b: { x: 1, y: 2 } });
    storage.set("settings", { a: 1, b: { x: 1, y: 2 } });
    storage.set("settings", { b: { y: 2, x: 1 }, a: 1 });
    expect(seen).toEqual(["settings"]);
    storage.set("settings", { a: 2, b: { x: 1, y: 2 } });
    expect(seen).toEqual(["settings", "settings"]);
    storage.remove("settings");
    storage.setRaw("expenses", "[]");
    expect(seen).toEqual(["settings", "settings", "settings", "expenses"]);
    storage.set("meta", { version: 3 }); // device-only: nobody is told
    expect(seen).toHaveLength(4);
  });

  it("a listener that throws cannot break a write", () => {
    storage.useUserCache("u1");
    storage.onStorageChange(() => {
      throw new Error("boom");
    });
    expect(storage.set("goals", [])).toBe(true);
    expect(ls.getItem("hisaab:u:u1:goals")).toBe("[]");
  });

  it("getRaw and setRaw (backup restore) follow the routing too", () => {
    storage.useUserCache("u1");
    storage.setRaw("assets", '[{"id":"as1"}]');
    expect(ls.getItem("hisaab:u:u1:assets")).toBe('[{"id":"as1"}]');
    expect(storage.getRaw("assets")).toBe('[{"id":"as1"}]');
    expect(ls.getItem("hisaab:assets")).toBeNull();
  });
});

describe("a change from the account reaches the live state without a reload", () => {
  it("arrays are replaced in place, objects get the new fields, a custom apply wins, an unregistered key is ignored", () => {
    const list = [{ id: "old" }];
    const obj: Record<string, unknown> = { keep: 1, a: 1 };
    const calls: unknown[] = [];
    storage.registerState("expenses", list);
    storage.registerState("settings", obj);
    storage.registerState("vault", null, (v: unknown) => calls.push(v));
    storage.applyToLive("expenses", [{ id: "n1" }, { id: "n2" }]);
    expect(list).toEqual([{ id: "n1" }, { id: "n2" }]); // the same array object
    storage.applyToLive("settings", { a: 2, b: 3 });
    expect(obj).toEqual({ keep: 1, a: 2, b: 3 });
    storage.applyToLive("vault", { c: 1 });
    expect(calls).toEqual([{ c: 1 }]);
    expect(() => storage.applyToLive("nothing", [])).not.toThrow();
    storage.applyToLive("expenses", undefined);
    expect(list).toEqual([]);
  });
});

describe("which mode a device starts in (decided before any composable loads)", () => {
  it("accounts off, nobody signed in, or the first-sign-in choice not done: guest mode", () => {
    expect(activateIfSignedIn(false)).toBeNull();
    expect(activateIfSignedIn(true)).toBeNull();
    writeHint({ userId: "u1", email: "a@b.test" });
    expect(activateIfSignedIn(true)).toBeNull(); // signed in, but no choice made yet: still the guest data
    expect(storage.isUserCacheActive()).toBe(false);
    markReady("u1");
    expect(activateIfSignedIn(false)).toBeNull(); // the flag is off: guest, whatever is stored
    expect(storage.isUserCacheActive()).toBe(false);
  });
  it("signed in and ready: account mode, routed to that user's cache", () => {
    writeHint({ userId: "u1", email: "a@b.test" });
    markReady("u1");
    expect(activateIfSignedIn(true)).toEqual({ userId: "u1", email: "a@b.test" });
    storage.set("expenses", [{ id: "x" }]);
    expect(ls.getItem("hisaab:u:u1:expenses")).toBe('[{"id":"x"}]');
  });
  it("a ready marker belongs to one user", () => {
    markReady("u1");
    writeHint({ userId: "u2", email: "b@b.test" });
    expect(isReady("u2")).toBe(false);
    expect(activateIfSignedIn(true)).toBeNull();
  });
  it("an unreadable or incomplete hint is no hint", () => {
    for (const bad of ["{not json", "null", "{}", '{"userId":"","email":"a"}', '{"userId":5,"email":"a"}', '"x"']) {
      ls.setItem("hisaab:auth:hint", bad);
      expect(readHint(), bad).toBeNull();
    }
    clearHint();
    expect(ls.getItem("hisaab:auth:hint")).toBeNull();
  });
  it("clearing a user's cache removes exactly that user's keys", () => {
    for (const k of ["expenses", "income", "sync:ready"]) ls.setItem(userKey("u1", k), "1");
    ls.setItem(userKey("u10", "expenses"), "keep"); // a user whose id merely starts the same
    ls.setItem(userKey("u2", "expenses"), "keep");
    ls.setItem("hisaab:expenses", "keep");
    ls.setItem("hisaab:meta", "keep");
    expect(clearUserCache("u1")).toBe(3);
    expect(Object.keys(ls.dump()).sort()).toEqual(["hisaab:expenses", "hisaab:meta", userKey("u10", "expenses"), userKey("u2", "expenses")].sort());
    expect(readyKey("u1")).toBe("hisaab:u:u1:sync:ready");
  });
  it("counts the guest records that could be uploaded", () => {
    expect(guestRecordCount()).toBe(0);
    for (const [k, v] of Object.entries(sampleStorage())) ls.setItem(`hisaab:${k}`, JSON.stringify(v));
    expect(guestRecordCount()).toBeGreaterThan(20);
    ls.setItem("hisaab:u:u1:expenses", JSON.stringify([{ id: "zz" }])); // a cache is not guest data
    const before = guestRecordCount();
    ls.removeItem("hisaab:u:u1:expenses");
    expect(guestRecordCount()).toBe(before);
  });
});

describe("the engine's local store (the user's cache)", () => {
  it("reads and writes the user's keys, removes on undefined, and survives unreadable data", () => {
    const s = userLocalStore("u1", { live: false, storage: ls as unknown as Storage });
    expect(s.read("expenses")).toBeUndefined();
    s.write("expenses", [{ id: "e1" }]);
    expect(ls.getItem("hisaab:u:u1:expenses")).toBe('[{"id":"e1"}]');
    expect(s.read("expenses")).toEqual([{ id: "e1" }]);
    ls.setItem("hisaab:u:u1:income", "{broken");
    expect(s.read("income")).toBeUndefined();
    s.write("expenses", undefined);
    expect(ls.getItem("hisaab:u:u1:expenses")).toBeNull();
  });
  it("with live on it also updates the page's state, and with live off it does not", () => {
    const list: unknown[] = [];
    storage.registerState("expenses", list);
    userLocalStore("u1", { live: false, storage: ls as unknown as Storage }).write("expenses", [{ id: "a" }]);
    expect(list).toEqual([]);
    userLocalStore("u1", { live: true, storage: ls as unknown as Storage }).write("expenses", [{ id: "b" }]);
    expect(list).toEqual([{ id: "b" }]);
  });
});

describe("the base store (IndexedDB hisaab-sync)", () => {
  let fake: { databases: Map<string, Map<string, unknown>> };
  beforeEach(() => {
    fake = installFakeIndexedDB();
  });

  it("is its own database, version 1: it never opens the attachment or backup databases", async () => {
    const opened: string[] = [];
    const real = globalThis.indexedDB.open.bind(globalThis.indexedDB);
    globalThis.indexedDB.open = ((name: string, version?: number) => (opened.push(`${name}@${version}`), real(name, version))) as typeof indexedDB.open;
    await idbBaseStore("u1").save({ put: [["expense/e1", { revision: 1, data: { id: "e1" } }]], cursor: 1 });
    expect([...new Set(opened)]).toEqual([`${DB_NAME}@1`]);
    expect(DB_NAME).toBe("hisaab-sync");
    expect([...fake.databases.keys()]).toEqual(["hisaab-sync"]);
  });

  it("nothing saved means no state (a device that never synced)", async () => {
    expect(await idbBaseStore("u1").load()).toBeNull();
  });

  it("saves and loads base entries, the cursor and the last upload", async () => {
    const b = idbBaseStore("u1");
    await b.save({ put: [["expense/e1", { revision: 4, data: { id: "e1", amount: 5 } }], ["expense/e2", { revision: 5, data: {}, deleted: true }]], cursor: 5, lastUpload: [["expense/e1", 4]], lastSyncAt: 123 });
    const s = (await b.load())!;
    expect(s.cursor).toBe(5);
    expect(s.lastUpload).toEqual([["expense/e1", 4]]);
    expect(s.lastSyncAt).toBe(123);
    expect(s.base.get("expense/e1")).toEqual({ revision: 4, data: { id: "e1", amount: 5 } });
    expect(s.base.get("expense/e2")).toEqual({ revision: 5, data: {}, deleted: true });
    expect([...s.base.keys()].sort()).toEqual(["expense/e1", "expense/e2"]);
  });

  it("a later save changes only what it names: deletes, a new cursor, clearing the last upload", async () => {
    const b = idbBaseStore("u1");
    await b.save({ put: [["a/1", { revision: 1, data: { id: "1" } }], ["a/2", { revision: 2, data: { id: "2" } }]], cursor: 2, lastUpload: [["a/1", 1]] });
    await b.save({ del: ["a/1"], put: [["a/2", { revision: 3, data: { id: "2", n: 1 } }]], cursor: 3, lastUpload: null });
    const s = (await b.load())!;
    expect([...s.base.keys()]).toEqual(["a/2"]);
    expect(s.base.get("a/2")!.revision).toBe(3);
    expect(s.cursor).toBe(3);
    expect(s.lastUpload).toEqual([]);
    await b.save({ put: [["a/3", { revision: 4, data: { id: "3" } }]] }); // no cursor named: the cursor stays
    expect((await b.load())!.cursor).toBe(3);
  });

  it("each user has their own rows, and clear removes only theirs", async () => {
    const a = idbBaseStore("ua");
    const b = idbBaseStore("ub");
    await a.save({ put: [["x/1", { revision: 1, data: { id: "1" } }]], cursor: 1 });
    await b.save({ put: [["x/1", { revision: 9, data: { id: "other" } }]], cursor: 9 });
    expect((await a.load())!.base.get("x/1")!.revision).toBe(1);
    expect((await b.load())!.base.get("x/1")!.revision).toBe(9);
    await a.clear();
    expect(await a.load()).toBeNull();
    expect((await b.load())!.cursor).toBe(9);
  });

  it("the whole database can be deleted (Reset all data)", async () => {
    await idbBaseStore("u1").save({ cursor: 1 });
    expect(fake.databases.has(DB_NAME)).toBe(true);
    await deleteSyncDatabase();
    expect(fake.databases.has(DB_NAME)).toBe(false);
    expect(await idbBaseStore("u1").load()).toBeNull();
  });
});

describe("the sync client", () => {
  const replying = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  it("turns every refusal into a kind the page understands", () => {
    const kind = (status: number, code = "x") => (toSyncError(new ApiError(status, code)) as SyncApiError).kind;
    expect(kind(0, "offline")).toBe("offline");
    expect(kind(401)).toBe("unauthenticated");
    expect(kind(403)).toBe("disabled");
    expect(kind(409, "schema_mismatch")).toBe("schema");
    expect(kind(409, "account_mismatch")).toBe("account");
    expect(kind(429)).toBe("rate");
    expect(kind(503)).toBe("server");
    expect(kind(500)).toBe("server");
    const other = new Error("x");
    expect(toSyncError(other)).toBe(other);
  });

  it("push and pull are POSTs with the data version, JSON bodies and the cookie; summary is a GET", async () => {
    const f = replying(200, { results: [], cursor: 0 });
    const api = httpSyncApi("user-7", f);
    await api.push([{ collection: "expense", id: "e1", base: 0, put: { id: "e1" } }]);
    await api.pull(7);
    await api.summary();
    const calls = (f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    expect(calls.map((c) => [c[0], c[1].method])).toEqual([["/api/sync/push", "POST"], ["/api/sync/pull", "POST"], ["/api/sync/summary", "GET"]]);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>)["x-hisaab-schema"]).toBe(String(SYNC_SCHEMA_VERSION));
      expect((init.headers as Record<string, string>)["x-hisaab-account"]).toBe("user-7"); // the account this browser is syncing for
      expect(init.credentials).toBe("same-origin");
    }
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ ops: [{ collection: "expense", id: "e1", base: 0, put: { id: "e1" } }] });
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ since: 7 });
  });

  it("a server refusal arrives as a SyncApiError", async () => {
    await expect(httpSyncApi("u", replying(401, { error: "unauthenticated" })).pull(0)).rejects.toMatchObject({ kind: "unauthenticated" });
    await expect(httpSyncApi("u", replying(409, { error: "schema_mismatch" })).push([])).rejects.toBeInstanceOf(SyncApiError);
    await expect(httpSyncApi("u", (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch).pull(0)).rejects.toMatchObject({ kind: "offline" });
  });
});
