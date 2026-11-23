import { describe, expect, it } from "vitest";
import { COLLECTION_BY_NAME, LIMITS, SYNC_SCHEMA_VERSION } from "../app/lib/sync/collections";
import { applyPush, checkSchema, projectionOf, pullSince, summaryOf, type PushResult } from "../server/utils/syncService";
import { fakeSyncRepo } from "./fakes/syncRepo";

const A = "user-a";
const B = "user-b";
const exp = (id: string, over: Record<string, unknown> = {}) => ({ id, date: "2026-11-20T07:00:00.000Z", amount: 12.5, categoryId: "cat-food", note: "lunch", ...over });
const put = (id: string, base = 0, over: Record<string, unknown> = {}, dayKey: string | null = "2026-11-20") => ({ collection: "expense", id, base, put: exp(id, over), dayKey });
const del = (collection: string, id: string, base: number) => ({ collection, id, base, delete: true });
const one = async (repo: ReturnType<typeof fakeSyncRepo>, user: string, op: unknown): Promise<PushResult> => (await applyPush(repo, user, { ops: [op] })).results[0]!;

describe("request-level checks", () => {
  it("only the server's own data version is accepted", () => {
    expect(() => checkSchema(String(SYNC_SCHEMA_VERSION))).not.toThrow();
    for (const bad of [undefined, "", "2", "4", "x"]) expect(() => checkSchema(bad), String(bad)).toThrowError(expect.objectContaining({ status: 409, code: "schema_mismatch" }));
  });
  it("a malformed body, and more than 200 operations, are refused as a whole", async () => {
    const repo = fakeSyncRepo();
    for (const body of [null, "x", [], {}, { ops: "x" }, { ops: [], extra: 1 }]) await expect(applyPush(repo, A, body), JSON.stringify(body)).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(applyPush(repo, A, { ops: Array.from({ length: LIMITS.maxOpsPerPush + 1 }, (_, i) => put(`e${i}`)) })).rejects.toMatchObject({ status: 413 });
    expect(repo.state.rows.size).toBe(0);
  });
});

describe("one bad operation is rejected on its own; the others are applied", () => {
  const reason = async (op: unknown) => {
    const r = await one(fakeSyncRepo(), A, op);
    return r.status === "rejected" ? r.reason : r.status;
  };
  it("names the reason", async () => {
    expect(await reason({ ...put("e1"), collection: "secrets" })).toBe("unknown_collection");
    expect(await reason({ ...put("e1"), collection: "__proto__" })).toBe("unknown_collection");
    expect(await reason({ ...put("e1"), id: "../x" })).toBe("invalid_id");
    expect(await reason({ ...put("e1"), id: "" })).toBe("invalid_id");
    expect(await reason({ collection: "expense", id: "e1", base: 0 })).toBe("invalid_operation"); // neither put nor delete
    expect(await reason({ ...put("e1"), delete: true })).toBe("invalid_operation"); // both
    expect(await reason({ ...put("e1"), base: -1 })).toBe("invalid_operation");
    expect(await reason({ ...put("e1"), base: 1.5 })).toBe("invalid_operation");
    expect(await reason({ ...put("e1"), extra: true })).toBe("invalid_operation"); // unknown members are refused
    expect(await reason({ ...put("e1"), put: { ...exp("e2") } })).toBe("id_mismatch");
    expect(await reason(put("e1", 0, { amount: "12.5" }))).toBe("invalid_record");
    expect(await reason(put("e1", 0, { amount: Number.POSITIVE_INFINITY }))).toBe("invalid_record");
    expect(await reason(put("e1", 0, { amount: 1e18 }))).toBe("invalid_amount");
    expect(await reason(put("e1", 0, { note: "x".repeat(COLLECTION_BY_NAME.expense!.maxBytes) }))).toBe("record_too_large");
    expect(await reason({ collection: "fundContribution", id: "c1", base: 0, put: { id: "c1", amount: 5 }, dayKey: "2026-11-20" })).toBe("invalid_record"); // a child without its parent id
  });
  it("a day key must be a real calendar date, exactly as YYYY-MM-DD", async () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-5", "20261120", "2026-11-20T00:00:00Z", "yesterday"]) expect(await reason(put("e1", 0, {}, bad)), bad).toBe("invalid_day");
    expect(await reason(put("e1", 0, {}, "2024-02-29"))).toBe("ok");
    expect(await reason(put("e1", 0, {}, null))).toBe("ok");
  });
  it("singletons only have their fixed id", async () => {
    expect(await reason({ collection: "settings", id: "other", base: 0, put: { currencySymbol: "$" } })).toBe("invalid_id");
    expect(await reason({ collection: "settings", id: "settings", base: 0, put: { currencySymbol: "$" } })).toBe("ok");
    expect(await reason({ collection: "vault", id: "vault", base: 0, put: { ciphertext: "x", iv: "y" } })).toBe("ok");
  });
  it("the others in the same push still apply", async () => {
    const repo = fakeSyncRepo();
    const r = await applyPush(repo, A, { ops: [put("e1"), { ...put("e2"), collection: "nope" }, put("e3")] });
    expect(r.results.map((x) => x.status)).toEqual(["ok", "rejected", "ok"]);
    expect([...repo.state.rows.values()].map((x) => x.id).sort()).toEqual(["e1", "e3"]);
  });
});

describe("revisions, conflicts and replays", () => {
  it("a new record gets the next revision; an update from the revision the pusher saw is accepted", async () => {
    const repo = fakeSyncRepo();
    const a = await one(repo, A, put("e1"));
    expect(a).toMatchObject({ status: "ok", revision: 1, version: 1 });
    const b = await one(repo, A, put("e1", 1, { amount: 20 }));
    expect(b).toMatchObject({ status: "ok", revision: 2, version: 2 });
    const c = await applyPush(repo, A, { ops: [put("e2"), put("e3")] });
    expect(c.results.map((r) => (r.status === "ok" ? r.revision : -1))).toEqual([3, 4]);
    expect(c.cursor).toBe(4);
  });
  it("a stale update is a conflict that carries the current record, and writes nothing", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    await one(repo, A, put("e1", 1, { amount: 99 })); // another device
    const r = await one(repo, A, put("e1", 1, { amount: 20 })); // this device still thinks revision 1
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.current).toMatchObject({ collection: "expense", id: "e1", revision: 2, deleted: false });
      expect((r.current.data as { amount: number }).amount).toBe(99);
    }
    expect((await pullSince(repo, A, 0)).records.find((x) => x.id === "e1")!.revision).toBe(2);
  });
  it("the same push twice is the same result (a lost answer is safe to retry)", async () => {
    const repo = fakeSyncRepo();
    const first = await applyPush(repo, A, { ops: [put("e1"), put("e2")] });
    const again = await applyPush(repo, A, { ops: [put("e1"), put("e2")] });
    expect(again.results).toEqual(first.results);
    expect(again.cursor).toBe(first.cursor);
    expect(repo.state.rows.size).toBe(2);
    // an update replayed after it succeeded
    await one(repo, A, put("e1", 1, { amount: 7 }));
    expect(await one(repo, A, put("e1", 1, { amount: 7 }))).toMatchObject({ status: "ok", revision: 3 });
    expect(repo.state.cursors.get(A)!.revision).toBe(3n);
  });
  it("an unchanged record pushed from its current revision writes nothing", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    await one(repo, A, put("e1", 1));
    expect(repo.state.cursors.get(A)!.revision).toBe(1n);
  });
});

describe("deletes are tombstones", () => {
  it("a delete keeps the row, clears its data and projection, and bumps the revision", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    const d = await one(repo, A, del("expense", "e1", 1));
    expect(d).toMatchObject({ status: "ok", revision: 2, deleted: true });
    const row = [...repo.state.rows.values()][0]!;
    expect(row).toMatchObject({ deleted: true, data: null, bytes: 0, projection: {} });
    const pulled = await pullSince(repo, A, 0);
    expect(pulled.records).toEqual([expect.objectContaining({ id: "e1", deleted: true, data: null, revision: 2 })]);
  });
  it("deleting again, or deleting what was never there, is a harmless ok", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    await one(repo, A, del("expense", "e1", 1));
    expect((await one(repo, A, del("expense", "e1", 1))).status).toBe("ok");
    expect((await one(repo, A, del("expense", "never", 0))).status).toBe("ok");
    expect(repo.state.cursors.get(A)!.revision).toBe(2n);
  });
  it("a delete from a stale revision is a conflict (someone edited it since): the record stays", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    await one(repo, A, put("e1", 1, { amount: 50 }));
    expect((await one(repo, A, del("expense", "e1", 1))).status).toBe("conflict");
    expect([...repo.state.rows.values()][0]!.deleted).toBe(false);
  });
  it("Undo: a put that saw the tombstone brings the record back with the same id", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    await one(repo, A, del("expense", "e1", 1));
    const back = await one(repo, A, put("e1", 2));
    expect(back).toMatchObject({ status: "ok", revision: 3, deleted: false });
    expect([...repo.state.rows.values()][0]).toMatchObject({ deleted: false, projection: expect.objectContaining({ amountMinor: 1250n }) });
  });
  it("a put that did NOT see the tombstone is a conflict that shows the tombstone", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("e1"));
    await one(repo, A, del("expense", "e1", 1));
    const r = await one(repo, A, put("e1", 1, { amount: 3 }));
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.current).toMatchObject({ deleted: true, data: null });
  });
});

describe("the projection (all the admin ever reads)", () => {
  const p = (collection: string, data: Record<string, unknown>, day: string | null = "2026-11-20") => projectionOf(COLLECTION_BY_NAME[collection]!, data, day);
  it("an expense: minor units, the client's day as sent, default kind, category and account", () => {
    expect(p("expense", exp("e1", { accountId: "acc1" }))).toEqual({ parentId: null, dayKey: "2026-11-20", amountMinor: 1250n, kind: "expense", categoryId: "cat-food", accountId: "acc1", sizeBytes: null });
    expect(p("expense", exp("e1", { kind: "refund" })).kind).toBe("refund");
  });
  it("money is exact integer minor units, including floating-point-awkward and negative values", () => {
    expect(p("expense", exp("e", { amount: 0.1 + 0.2 })).amountMinor).toBe(30n);
    expect(p("expense", exp("e", { amount: 1200.5 })).amountMinor).toBe(120050n);
    expect(p("fundValue", { id: "v", fundId: "f", value: -3 }).amountMinor).toBe(-300n);
    expect(p("expense", exp("e", { amount: 0 })).amountMinor).toBe(0n);
  });
  it("no amount is no amount (null), not zero", () => {
    expect(p("fuelLog", { id: "l", vehicleId: "v", cost: null }).amountMinor).toBeNull();
    expect(p("fuelLog", { id: "l", vehicleId: "v" }).amountMinor).toBeNull();
    expect(p("meterReading", { id: "m", connectionId: "c", reading: 120 }).amountMinor).toBeNull();
  });
  it("children carry the parent's id; the day is whatever the client sent, never derived from the data", () => {
    expect(p("fundContribution", { id: "c1", fundId: "f1", date: "2026-11-19T20:00:00.000Z", amount: 100 }, "2026-11-20")).toMatchObject({ parentId: "f1", dayKey: "2026-11-20", amountMinor: 10000n });
    expect(p("expense", exp("e"), null).dayKey).toBeNull(); // a timestamp with no key from the client stays unkeyed: the server does not guess a day
  });
  it("notes, names and every other field never reach a projection column", () => {
    const row = p("expense", exp("e1", { note: "private note", receipts: [{ id: "r" }] }));
    expect(JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/private|lunch|receipt/);
  });
});

describe("one user never sees or changes another's records", () => {
  it("the same record id for two users are two records, and pull is per user", async () => {
    const repo = fakeSyncRepo();
    await one(repo, A, put("same", 0, { amount: 1 }));
    await one(repo, B, put("same", 0, { amount: 2 }));
    expect((await pullSince(repo, A, 0)).records.map((r) => (r.data as { amount: number }).amount)).toEqual([1]);
    expect((await pullSince(repo, B, 0)).records.map((r) => (r.data as { amount: number }).amount)).toEqual([2]);
    // B's revision counter is B's own
    expect(repo.state.cursors.get(A)!.revision).toBe(1n);
    expect(repo.state.cursors.get(B)!.revision).toBe(1n);
    // A cannot delete B's record by naming it: the id resolves inside A's own records
    expect((await one(repo, A, del("expense", "same", 1))).status).toBe("ok");
    expect((await pullSince(repo, B, 0)).records[0]).toMatchObject({ deleted: false });
  });
});

describe("pull", () => {
  it("returns changes after the cursor, oldest first, and pages", async () => {
    const repo = fakeSyncRepo();
    for (let i = 0; i < 3; i++) await applyPush(repo, A, { ops: Array.from({ length: 200 }, (_, j) => put(`e${i * 200 + j}`)).slice(0, i === 2 ? 101 : 200) });
    const p1 = await pullSince(repo, A, 0);
    expect(p1.records).toHaveLength(LIMITS.maxPullRecords);
    expect(p1.more).toBe(true);
    expect(p1.cursor).toBe(LIMITS.maxPullRecords);
    const p2 = await pullSince(repo, A, p1.cursor);
    expect(p2.records).toHaveLength(501 - LIMITS.maxPullRecords);
    expect(p2.more).toBe(false);
    const p3 = await pullSince(repo, A, p2.cursor);
    expect(p3).toEqual({ records: [], cursor: p2.cursor, more: false });
  });
  it("refuses a cursor that is not a non-negative integer", async () => {
    for (const bad of [-1, 1.5, "0", null, undefined, NaN, {}]) await expect(pullSince(fakeSyncRepo(), A, bad), String(bad)).rejects.toMatchObject({ status: 400 });
  });
});

describe("limits per user", () => {
  it("an account cannot grow past its byte cap; the record that would cross it is rejected, the rest stay", async () => {
    const repo = fakeSyncRepo();
    const big = "x".repeat(15 * 1024);
    let rejected = 0;
    let accepted = 0;
    for (let i = 0; i < 9; i++) {
      const r = await applyPush(repo, A, { ops: Array.from({ length: 200 }, (_, j) => put(`e${i}-${j}`, 0, { note: big })) });
      for (const x of r.results) {
        if (x.status === "ok") accepted++;
        else if (x.status === "rejected" && x.reason === "quota_exceeded") rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(1000);
    expect((await summaryOf(repo, A)).bytes).toBeLessThanOrEqual(LIMITS.maxUserBytes);
    // another user is unaffected
    expect((await one(repo, B, put("fresh"))).status).toBe("ok");
    // deleting frees the room again
    const before = (await summaryOf(repo, A)).bytes;
    await one(repo, A, del("expense", "e0-0", 1));
    expect((await summaryOf(repo, A)).bytes).toBeLessThan(before);
  });
});

describe("summary", () => {
  it("counts records, not content, and does not count tombstones", async () => {
    const repo = fakeSyncRepo();
    await applyPush(repo, A, { ops: [put("e1"), put("e2")] });
    await one(repo, A, del("expense", "e2", 2));
    const s = await summaryOf(repo, A);
    expect(s).toMatchObject({ records: 1, revision: 3 });
    expect(Object.keys(s).sort()).toEqual(["bytes", "maxBytes", "records", "revision"]);
    expect(await summaryOf(repo, B)).toMatchObject({ records: 0, revision: 0 });
  });
});
