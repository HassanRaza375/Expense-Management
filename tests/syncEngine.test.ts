import { describe, expect, it } from "vitest";
import { ADAPTERS } from "../app/lib/sync/adapters";
import { SyncApiError } from "../app/lib/sync/engine";
import { recordKey } from "../app/lib/sync/collections";
import { clone, sampleStorage } from "./helpers/syncData";
import { device, newAccount, type Device } from "./helpers/syncHarness";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const byId = (list: Row[] | undefined, id: string): Row | undefined => list?.find((x) => x.id === id);
const ids = (list: Row[] | undefined): string[] => (list ?? []).map((x) => x.id).sort();
const serverLive = (acct: ReturnType<typeof newAccount>, collection: string) =>
  [...acct.repo.state.rows.values()].filter((r) => r.collection === collection && !r.deleted).map((r) => r.id).sort();

/** Arrays of records are compared by id: each device keeps its own order (its own records first, new ones as they arrive), and nothing in the app depends on it. */
function sortedById(v: unknown): unknown {
  if (Array.isArray(v)) {
    const items = v.map(sortedById);
    return items.every((x) => x && typeof x === "object" && "id" in (x as object)) ? [...items].sort((a, b) => String((a as Row).id).localeCompare(String((b as Row).id))) : items;
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sortedById(x)]));
  return v;
}

/** The stored values without the parts that never leave a device (bill files, the theme), for comparing two devices. Receipts are synced records now. */
function shared(d: Device): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of ADAPTERS) {
    const v = clone(d.get(a.key));
    if (a.key === "bills" && v) (v as Row).bills?.forEach((b: Row) => (b.attachments = []));
    if (a.key === "settings" && v) delete (v as Row).theme;
    out[a.key] = sortedById(v);
  }
  return out;
}

describe("one device uploads, another receives", () => {
  it("every key arrives intact on the second device (device-only parts excepted)", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    const r = await A.sync();
    expect(r.pending).toBe(0);
    expect(r.rejected).toEqual([]);
    await B.sync();
    expect(shared(B)).toEqual(shared(A));
    expect(B.get("expenses")).toHaveLength(3);
    expect(byId(B.get("expenses"), "e1")!.receipts).toEqual(byId(A.get("expenses"), "e1")!.receipts); // a receipt is a record of its own: it arrives with the expense (its file is on the account's storage)
    expect(byId(B.get("bills").bills, "b1").attachments).toEqual([]);
    expect(B.get("settings")).not.toHaveProperty("theme");
    expect(B.get("investments")[0].contributions).toHaveLength(1);
    expect(B.get("vault")).toEqual(A.get("vault"));
  });

  it("a second run with nothing changed sends nothing and writes nothing", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    await A.sync();
    const pushes = A.calls.push.length;
    const writes = A.writes.length;
    const r = await A.sync();
    expect(A.calls.push.length).toBe(pushes);
    expect(A.writes.length).toBe(writes);
    expect(r).toMatchObject({ pushed: 0, pending: 0, held: null, incomplete: false });
  });

  it("the server holds one record per thing, flattened, with money in minor units", async () => {
    const acct = newAccount();
    await (await device("A", acct, sampleStorage())).sync();
    expect(serverLive(acct, "expense")).toEqual(["e1", "e2", "e3"]);
    expect(serverLive(acct, "fundContribution")).toEqual(["fc1"]);
    expect(serverLive(acct, "repayment")).toEqual(["rp1"]);
    expect(serverLive(acct, "goalSaving")).toEqual(["s1"]);
    expect(serverLive(acct, "correction")).toEqual(["adj1"]);
    const e2 = acct.repo.state.rows.get(`${acct.userId}\u0000expense\u0000e2`)!;
    expect(e2.projection.amountMinor).toBe(12050n);
    expect(e2.projection.dayKey).toMatch(/^2026-11-1[789]$/);
    expect(JSON.stringify(e2.projection, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/Lunch/);
  });

  it("default categories that nobody edited are not sent", async () => {
    const acct = newAccount();
    const A = await device("A", acct, { expenses: sampleStorage().expenses });
    await A.sync();
    expect(serverLive(acct, "category")).toEqual([]);
    expect(serverLive(acct, "vehicleTag")).toEqual([]);
  });
});

describe("the same expense edited on both devices", () => {
  async function setup() {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    return { acct, A, B };
  }

  it("different fields: both edits survive on both devices", async () => {
    const { A, B } = await setup();
    const a = A.get("expenses");
    byId(a, "e1")!.amount = 950;
    A.set("expenses", a);
    const b = B.get("expenses");
    byId(b, "e1")!.note = "Groceries and milk";
    B.set("expenses", b);
    await A.sync();
    const rb = await B.sync();
    await A.sync();
    for (const d of [A, B]) expect(byId(d.get("expenses"), "e1")).toMatchObject({ amount: 950, note: "Groceries and milk" });
    expect(rb.merged).toBe(1); // both sides had changed this record: merged field by field, no field was in conflict
    expect(shared(A)).toEqual(shared(B));
  });

  it("the same field: the device that syncs later wins, and both converge on it", async () => {
    const { A, B } = await setup();
    const a = A.get("expenses");
    byId(a, "e1")!.note = "from A";
    A.set("expenses", a);
    const b = B.get("expenses");
    byId(b, "e1")!.note = "from B";
    B.set("expenses", b);
    await A.sync();
    const r = await B.sync();
    await A.sync();
    expect(r.merged).toBe(1);
    for (const d of [A, B]) expect(byId(d.get("expenses"), "e1")!.note).toBe("from B");
    expect(shared(A)).toEqual(shared(B));
  });

  it("a receipt added on one device and an edit of the expense on the other both survive", async () => {
    const { A, B } = await setup();
    const b = B.get("expenses");
    byId(b, "e1")!.receipts.push({ id: "mine", filename: "b.jpg", mimeType: "image/jpeg", size: 10 });
    B.set("expenses", b);
    const a = A.get("expenses");
    byId(a, "e1")!.amount = 1;
    A.set("expenses", a);
    await A.sync();
    await B.sync();
    const e1 = byId(B.get("expenses"), "e1")!;
    expect(e1.amount).toBe(1);
    expect((e1.receipts as Row[]).map((r) => r.id).sort()).toEqual(["mine", "r1"]); // the account's receipt and this device's new one
  });
});

describe("fund contributions added on both devices", () => {
  it("none overwrites the other, because each is its own record", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    const fa = A.get("investments");
    fa[0].contributions.push({ id: "fc-A", date: "2026-11-20T00:00:00.000Z", amount: 200, notes: "from A", createdAt: "2026-11-20T00:00:00.000Z" });
    A.set("investments", fa);
    const fb = B.get("investments");
    fb[0].contributions.push({ id: "fc-B", date: "2026-11-20T00:00:00.000Z", amount: 300, notes: "from B", createdAt: "2026-11-20T00:00:00.000Z" });
    fb[0].withdrawals.push({ id: "fw-B", date: "2026-11-21T00:00:00.000Z", amount: 50, notes: "", createdAt: "2026-11-21T00:00:00.000Z" });
    B.set("investments", fb);
    await A.sync();
    await B.sync();
    await A.sync();
    for (const d of [A, B]) {
      expect(ids(d.get("investments")[0].contributions)).toEqual(["fc-A", "fc-B", "fc1"]);
      expect(ids(d.get("investments")[0].withdrawals)).toEqual(["fw-B", "fw1"]);
    }
    expect(serverLive(acct, "fundContribution")).toEqual(["fc-A", "fc-B", "fc1"]);
    expect(shared(A)).toEqual(shared(B));
  });
});

describe("deletes are tombstones, and Undo brings the record back", () => {
  it("a delete on one device removes it on the other; re-adding the same record restores it everywhere", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    const gone = clone(byId(A.get("expenses"), "e2")!);
    A.set("expenses", A.get("expenses").filter((e: Row) => e.id !== "e2"));
    await A.sync();
    await B.sync();
    expect(byId(B.get("expenses"), "e2")).toBeUndefined();
    const row = acct.repo.state.rows.get(`${acct.userId}\u0000expense\u0000e2`)!;
    expect(row).toMatchObject({ deleted: true, data: null }); // the row is kept
    A.set("expenses", [...A.get("expenses"), gone]); // Undo: the same record, the same id
    const r = await A.sync();
    expect(r.rejected).toEqual([]);
    await B.sync();
    expect(byId(B.get("expenses"), "e2")).toEqual(gone);
    expect(acct.repo.state.rows.get(`${acct.userId}\u0000expense\u0000e2`)).toMatchObject({ deleted: false });
  });

  it("an edit beats a delete: edited on B while A deleted it, the record stays everywhere (with B's edit)", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    A.set("expenses", A.get("expenses").filter((e: Row) => e.id !== "e2"));
    await A.sync();
    const b = B.get("expenses");
    byId(b, "e2")!.amount = 999;
    B.set("expenses", b);
    await B.sync();
    await A.sync();
    for (const d of [A, B]) expect(byId(d.get("expenses"), "e2")).toMatchObject({ amount: 999 });
    expect(serverLive(acct, "expense")).toContain("e2");
  });

  it("and the other way round: edited and synced on B first, then A deletes from an old view: the record comes back to A", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    const b = B.get("expenses");
    byId(b, "e2")!.amount = 777;
    B.set("expenses", b);
    await B.sync();
    A.set("expenses", A.get("expenses").filter((e: Row) => e.id !== "e2"));
    await A.sync();
    expect(byId(A.get("expenses"), "e2")).toMatchObject({ amount: 777 });
    expect(serverLive(acct, "expense")).toContain("e2");
  });

  it("a fund deleted on A while B added a contribution to it: the fund and B's contribution stay", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    const fb = B.get("investments");
    fb[0].contributions.push({ id: "fc9", date: "2026-11-20T00:00:00.000Z", amount: 5, notes: "", createdAt: "2026-11-20T00:00:00.000Z" });
    B.set("investments", fb);
    A.set("investments", []);
    await A.sync();
    await B.sync();
    await A.sync();
    for (const d of [A, B]) {
      expect(ids(d.get("investments"))).toEqual(["f1"]);
      expect(ids(d.get("investments")[0].contributions)).toEqual(["fc9"]); // the old ones were deleted with the fund; the new one was not lost
    }
    expect(shared(A)).toEqual(shared(B));
  });
});

describe("offline, then back online", () => {
  it("edits made offline wait (counted), nothing is lost, and they go out when the network is back", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    A.online = false;
    const a = A.get("expenses");
    byId(a, "e1")!.amount = 1;
    byId(a, "e1")!.amount = 2; // two edits of one record are one change
    a.push({ id: "e-new", date: "2026-11-20T07:00:00.000Z", amount: 9, categoryId: "cat-food", note: "", createdAt: "2026-11-20T07:00:00.000Z" });
    A.set("expenses", a);
    await expect(A.sync()).rejects.toMatchObject({ kind: "offline" });
    expect(A.engine.pending()).toBe(2);
    expect(A.get("expenses")).toHaveLength(4); // still all here
    await B.sync();
    expect(byId(B.get("expenses"), "e-new")).toBeUndefined();
    A.online = true;
    const r = await A.sync();
    expect(r).toMatchObject({ pending: 0, pushed: 2 });
    await B.sync();
    expect(byId(B.get("expenses"), "e-new")).toBeTruthy();
    expect(byId(B.get("expenses"), "e1")!.amount).toBe(2);
  });

  it("going offline in the middle of a run keeps what was already sent and sends the rest later", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const real = A.engine as unknown as { deps: { api: { push: (o: unknown[]) => Promise<unknown> } } };
    const push = real.deps.api.push;
    let calls = 0;
    real.deps.api.push = async (ops) => {
      if (++calls === 2) throw new SyncApiError("offline");
      return push(ops);
    };
    // 450 records go out as three batches of at most 200 (the second fails)
    const many = Array.from({ length: 450 }, (_, i) => ({ id: `x${i}`, date: "2026-11-20T07:00:00.000Z", amount: i + 1, categoryId: "cat-food", note: "", createdAt: "2026-11-20T07:00:00.000Z" }));
    A.set("expenses", many);
    await expect(A.sync()).rejects.toMatchObject({ kind: "offline" });
    expect(serverLive(acct, "expense").length).toBeGreaterThan(150); // the first batch (200 operations, a few of them other collections) is there
    expect(serverLive(acct, "expense").length).toBeLessThan(450);
    expect(A.engine.pending()).toBeGreaterThan(0);
    real.deps.api.push = push;
    await A.sync();
    expect(serverLive(acct, "expense")).toHaveLength(450);
    expect(A.engine.pending()).toBe(0);
  });

  it("a push whose answer was lost is safe to repeat: nothing is duplicated and no revision is wasted", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    A.loseNextPushAnswer = true;
    await expect(A.sync()).rejects.toMatchObject({ kind: "offline" });
    const after = acct.repo.state.cursors.get(acct.userId)!.revision;
    expect(after).toBeGreaterThan(0n); // the server did apply it
    await A.sync();
    expect(acct.repo.state.cursors.get(acct.userId)!.revision).toBe(after); // the repeat wrote nothing
    expect(serverLive(acct, "expense")).toEqual(["e1", "e2", "e3"]);
    expect(A.engine.pending()).toBe(0);
  });
});

describe("what a pull never touches", () => {
  it("this device's theme survives account changes", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct, { settings: { currencySymbol: "Rs", theme: "light" } });
    await A.sync();
    await B.sync();
    expect(B.get("settings").theme).toBe("light");
    const s = A.get("settings");
    s.currencySymbol = "$";
    s.theme = "dark";
    A.set("settings", s);
    await A.sync();
    await B.sync();
    expect(B.get("settings")).toMatchObject({ currencySymbol: "$", theme: "light" });
    expect(A.get("settings").theme).toBe("dark");
  });

  it("an edit typed while the network was busy is not overwritten by the pull that was in flight", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    const a = A.get("expenses");
    byId(a, "e2")!.amount = 55;
    A.set("expenses", a);
    await A.sync(); // the account now has e2 = 55
    B.duringPull = () => {
      const b = B.get("expenses");
      byId(b, "e1")!.note = "typed meanwhile";
      b.push({ id: "e-typed", date: "2026-11-20T07:00:00.000Z", amount: 3, categoryId: "cat-food", note: "", createdAt: "2026-11-20T07:00:00.000Z" });
      B.set("expenses", b);
    };
    await B.sync();
    expect(byId(B.get("expenses"), "e2")!.amount).toBe(55); // the account's change arrived
    expect(byId(B.get("expenses"), "e1")!.note).toBe("typed meanwhile"); // and the edit survived
    expect(byId(B.get("expenses"), "e-typed")).toBeTruthy();
    await A.sync();
    expect(byId(A.get("expenses"), "e-typed")).toBeTruthy();
  });
});

describe("a push that would delete most of the account is held", () => {
  async function thirty() {
    const acct = newAccount();
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, date: "2026-11-20T07:00:00.000Z", amount: i + 1, categoryId: "cat-food", note: "", createdAt: "2026-11-20T07:00:00.000Z" }));
    const A = await device("A", acct, { expenses: many });
    await A.sync();
    return { acct, A, many };
  }

  it("a blank or stale device does not empty the account", async () => {
    const { acct, A } = await thirty();
    A.set("expenses", []);
    const r = await A.sync();
    expect(r.held).toEqual({ deletes: 30, of: 30 });
    expect(serverLive(acct, "expense")).toHaveLength(30);
    expect(A.engine.pending()).toBe(30);
  });

  it("small deletes go through: fewer than 10, or less than half", async () => {
    const { acct, A, many } = await thirty();
    A.set("expenses", many.slice(5));
    expect((await A.sync()).held).toBeNull();
    expect(serverLive(acct, "expense")).toHaveLength(25);
    A.set("expenses", many.slice(20)); // 15 more of 25 = 60%: held
    expect((await A.sync()).held).toEqual({ deletes: 15, of: 25 });
    A.set("expenses", many.slice(15)); // 10 more of 25 = 40%: goes
    expect((await A.sync()).held).toBeNull();
    expect(serverLive(acct, "expense")).toHaveLength(15);
  });

  it("confirming sends them; restoring brings the account's data back instead", async () => {
    const { acct, A } = await thirty();
    A.set("expenses", []);
    await A.sync();
    await A.engine.restoreFromAccount();
    expect(A.get("expenses")).toBeUndefined();
    const fresh = await A.engine.init();
    expect(fresh.fresh).toBe(true);
    await A.sync();
    expect(A.get("expenses")).toHaveLength(30);
    expect(serverLive(acct, "expense")).toHaveLength(30);

    A.set("expenses", []);
    const held = await A.sync();
    expect(held.held).not.toBeNull();
    const done = await A.sync({ allowMassDelete: true });
    expect(done.held).toBeNull();
    expect(serverLive(acct, "expense")).toHaveLength(0);
  });
});

describe("the first sign-in", () => {
  const guest = (extra: Record<string, unknown> = {}) => ({ ...sampleStorage(), ...extra });

  it("'Upload this device's data': everything goes up; the guest copy is untouched; Undo removes exactly what the upload created", async () => {
    const acct = newAccount();
    const X = await device("X", acct, { expenses: [{ id: "x1", date: "2026-11-01T07:00:00.000Z", amount: 7, categoryId: "cat-food", note: "already in the account", createdAt: "2026-11-01T07:00:00.000Z" }] });
    await X.sync();
    const g = guest();
    const before = clone(g);
    const Y = await device("Y", acct);
    const up = await Y.engine.uploadDeviceData((k) => g[k]);
    expect(up.uploaded).toBeGreaterThan(20);
    expect(up.pending).toBe(0);
    expect(g).toEqual(before); // the guest storage was only read
    expect(ids(Y.get("expenses"))).toEqual(["e1", "e2", "e3", "x1"]); // the account's own record arrived too
    expect(serverLive(acct, "expense")).toEqual(["e1", "e2", "e3", "x1"]);
    expect(Y.engine.uploaded).toHaveLength(up.uploaded);

    const u = await Y.engine.undoUpload();
    expect(u.removed).toBe(up.uploaded);
    expect(serverLive(acct, "expense")).toEqual(["x1"]); // the account is as it was
    expect(ids(Y.get("expenses"))).toEqual(["x1"]);
    expect(serverLive(acct, "fund")).toEqual([]);
    expect(Y.engine.uploaded).toEqual([]);
    expect(g).toEqual(before);
  });

  it("Undo leaves alone anything changed since the upload", async () => {
    const acct = newAccount();
    const Y = await device("Y", acct);
    const g = guest();
    await Y.engine.uploadDeviceData((k) => g[k]);
    const e = Y.get("expenses");
    byId(e, "e1")!.amount = 4242;
    Y.set("expenses", e);
    await Y.sync();
    const u = await Y.engine.undoUpload();
    expect(ids(Y.get("expenses"))).toEqual(["e1"]);
    expect(byId(Y.get("expenses"), "e1")!.amount).toBe(4242);
    expect(u.removed).toBeGreaterThan(10);
  });

  it("when the account already holds the same records, the device's value wins where they differ and the account's extra fields stay", async () => {
    const acct = newAccount();
    const X = await device("X", acct, { expenses: [{ id: "e1", date: "2026-11-19T07:00:00.000Z", amount: 1, categoryId: "cat-food", note: "account note", extra: "kept", createdAt: "x" }] });
    await X.sync();
    const Y = await device("Y", acct);
    await Y.engine.uploadDeviceData((k) => sampleStorage()[k]);
    expect(byId(Y.get("expenses"), "e1")).toMatchObject({ amount: 900, note: "Groceries", extra: "kept" });
    await X.sync();
    expect(byId(X.get("expenses"), "e1")).toMatchObject({ amount: 900, extra: "kept" });
  });

  it("'Start with my account's data': an empty device receives everything and sends nothing", async () => {
    const acct = newAccount();
    await (await device("A", acct, sampleStorage())).sync();
    const B = await device("B", acct);
    const r = await B.engine.startWithAccount();
    expect(r.pushed).toBe(0);
    expect(r.pulled).toBeGreaterThan(20);
    expect(ids(B.get("expenses"))).toEqual(["e1", "e2", "e3"]);
  });
});

describe("robustness", () => {
  it("records the server refuses stay on the device, are reported, and do not stop the others", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const e = A.get("expenses");
    e.push({ id: "bad", date: "2026-11-20T07:00:00.000Z", amount: "twelve", categoryId: "cat-food" });
    A.set("expenses", e);
    const r = await A.sync();
    expect(r.rejected).toEqual([{ key: "expense/bad", reason: "invalid_record" }]);
    expect(serverLive(acct, "expense")).toEqual(["e1", "e2", "e3"]);
    expect(byId(A.get("expenses"), "bad")).toBeTruthy(); // never dropped
    expect(r.pending).toBe(1);
    expect(A.calls.push.length).toBeLessThan(6); // it did not loop on the refusal
  });

  it("a collection this version does not know is ignored, never an error, and the cursor still moves", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    await A.sync();
    await acct.repo.transaction(acct.userId, async (tx) => {
      const c = await tx.lockCursor(acct.userId);
      await tx.put(acct.userId, { collection: "futureThing", id: "z1", data: { id: "z1" }, version: 1, revision: c.revision + 1n, deleted: false, bytes: 10, projection: {} });
      await tx.setCursor(acct.userId, c.revision + 1n, c.bytes + 10);
    });
    const r = await A.sync();
    expect(r.pulled).toBe(1);
    expect(r.pending).toBe(0);
    expect((await A.sync()).pulled).toBe(0);
  });

  it("a device with data but no base (the base was lost) keeps its edits and still receives the account's changes", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    await A.sync();
    const B = await device("B", acct);
    await B.sync();
    const b = B.get("expenses");
    byId(b, "e2")!.amount = 4;
    B.set("expenses", b);
    await B.bases.clear(); // the base is gone, the data is not
    const B2 = await device("B2", acct, Object.fromEntries(ADAPTERS.map((a) => [a.key, B.get(a.key)]).filter(([, v]) => v !== undefined)));
    expect((await B2.engine.init()).fresh).toBe(true);
    const a = A.get("expenses");
    byId(a, "e3")!.note = "changed on A";
    a.push({ id: "from-a", date: "2026-11-20T07:00:00.000Z", amount: 1, categoryId: "cat-food", note: "", createdAt: "x" });
    A.set("expenses", a);
    await A.sync();
    await B2.sync();
    expect(byId(B2.get("expenses"), "e2")!.amount).toBe(4); // the edit survived
    expect(byId(B2.get("expenses"), "e3")!.note).toBe("Refund"); // with no base the device's value wins where they differ (the app takes a safety snapshot first)
    expect(ids(B2.get("expenses"))).toEqual(["e1", "e2", "e3", "from-a"]); // the account's other changes arrive, nothing is doubled
  });

  it("two devices syncing at the same moment end up the same", async () => {
    const acct = newAccount();
    const A = await device("A", acct, sampleStorage());
    const B = await device("B", acct);
    await A.sync();
    await B.sync();
    const a = A.get("expenses");
    a.push({ id: "from-a", date: "2026-11-20T07:00:00.000Z", amount: 1, categoryId: "cat-food", note: "", createdAt: "2026-11-20T07:00:00.000Z" });
    A.set("expenses", a);
    const b = B.get("expenses");
    b.push({ id: "from-b", date: "2026-11-20T07:00:00.000Z", amount: 2, categoryId: "cat-food", note: "", createdAt: "2026-11-20T07:00:00.000Z" });
    B.set("expenses", b);
    await Promise.all([A.sync(), B.sync()]);
    await Promise.all([A.sync(), B.sync()]);
    expect(ids(A.get("expenses"))).toEqual(["e1", "e2", "e3", "from-a", "from-b"]);
    expect(shared(A)).toEqual(shared(B));
  });

  it("the record key helper is the one the base uses", () => {
    expect(recordKey("expense", "e1")).toBe("expense/e1");
  });
});

describe("convergence (randomised): whatever the devices do, once they have all synced they agree", () => {
  // a small seeded generator, so a failure can be replayed
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 3 devices, 120 random steps (add, edit, delete, sync, offline)`, async () => {
      const rand = rng(seed);
      const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
      const acct = newAccount();
      const devices = [await device("A", acct, sampleStorage()), await device("B", acct), await device("C", acct)];
      await devices[0]!.sync();
      let counter = 0;
      for (let step = 0; step < 120; step++) {
        const d = pick(devices);
        const op = rand();
        if (op < 0.2) {
          const e = d.get("expenses") ?? [];
          e.push({ id: `n${++counter}`, date: "2026-11-20T07:00:00.000Z", amount: Math.floor(rand() * 1000), categoryId: "cat-food", note: `n${counter}`, createdAt: "2026-11-20T07:00:00.000Z" });
          d.set("expenses", e);
        } else if (op < 0.4) {
          const e = d.get("expenses") ?? [];
          if (e.length) {
            const x = pick(e) as Row;
            // only valid edits: a value the server would refuse stays on its device by design (tested above) and would make the devices differ
            const field = pick(["amount", "note", "categoryId"]);
            x[field] = field === "amount" ? pick([1, 2, 3.5, 40]) : field === "note" ? pick(["p", "q", ""]) : pick(["cat-food", "cat-other"]);
            d.set("expenses", e);
          }
        } else if (op < 0.5) {
          const e = (d.get("expenses") ?? []) as Row[];
          if (e.length) d.set("expenses", e.filter((x) => x.id !== pick(e).id));
        } else if (op < 0.6) {
          const f = d.get("investments") ?? [];
          if (f[0]) {
            f[0].contributions.push({ id: `c${++counter}`, date: "2026-11-20T00:00:00.000Z", amount: counter, notes: "", createdAt: "x" });
            d.set("investments", f);
          }
        } else if (op < 0.65) {
          d.online = !d.online;
        } else {
          try {
            await d.sync({ allowMassDelete: true });
          } catch (e) {
            if (!(e instanceof SyncApiError)) throw e;
          }
        }
      }
      for (const d of devices) d.online = true;
      for (let round = 0; round < 3; round++) for (const d of devices) await d.sync({ allowMassDelete: true });
      expect(shared(devices[1]!)).toEqual(shared(devices[0]!));
      expect(shared(devices[2]!)).toEqual(shared(devices[0]!));
      for (const d of devices) expect(d.engine.pending()).toBe(0);
      // and the account agrees with them
      expect(serverLive(acct, "expense")).toEqual(ids(devices[0]!.get("expenses")));
    });
  }
});
