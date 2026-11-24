import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { txFor } from "../server/utils/syncRepo";
import type { Row } from "../server/utils/syncTypes";
import { fakeSyncRepo } from "./fakes/syncRepo";

const row = (over: Partial<Row> = {}): Row => ({ collection: "expense", id: "e1", data: { amount: 5 }, version: 1, revision: 1n, deleted: false, bytes: 10, projection: { dayKey: "2026-11-20", amountMinor: 500n, kind: "expense" }, ...over });

describe("the Prisma repository scopes every query by userId", () => {
  // a recording client: it remembers the arguments of every call, so the test can look for the user's id in each
  const calls: Array<{ op: string; args: unknown }> = [];
  const rec = (op: string, result: unknown = null) => async (args?: unknown) => {
    calls.push({ op, args });
    return result;
  };
  const db = {
    syncCursor: { upsert: rec("cursor.upsert", { revision: 3n, bytes: 7 }), update: rec("cursor.update") },
    syncDoc: { findUnique: rec("doc.findUnique"), upsert: rec("doc.upsert") },
  };
  const tx = txFor(db as never);

  it("lock, read, write and cursor calls all carry the user id", async () => {
    calls.length = 0;
    expect(await tx.lockCursor("user-A")).toEqual({ revision: 3n, bytes: 7 });
    await tx.record("user-A", "expense", "e1");
    await tx.put("user-A", row());
    await tx.setCursor("user-A", 4n, 17);
    expect(calls.map((c) => c.op)).toEqual(["cursor.upsert", "doc.findUnique", "doc.upsert", "cursor.update"]);
    for (const c of calls) expect(JSON.stringify(c.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), c.op).toContain("user-A");
  });

  it("never mentions another user's id when asked for one user's rows", async () => {
    calls.length = 0;
    await tx.record("user-B", "income", "i9");
    expect(JSON.stringify(calls)).not.toContain("user-A");
  });

  it("the cursor row is locked by UPDATING it (pushes of two devices are ordered), and there is no raw SQL (it would ignore the schema the client works in)", async () => {
    calls.length = 0;
    expect(await tx.lockCursor("user-A")).toEqual({ revision: 3n, bytes: 7 });
    const args = calls[0]!.args as { where: { userId: string }; update: { updatedAt: Date } };
    expect(calls.map((c) => c.op)).toEqual(["cursor.upsert"]);
    expect(args.where).toEqual({ userId: "user-A" });
    expect(args.update.updatedAt).toBeInstanceOf(Date); // the update is what takes the lock
    const src = readFileSync(fileURLToPath(new URL("../server/utils/syncRepo.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/\$queryRaw|\$executeRaw|Unsafe/);
  });

  it("two first pushes at the same moment: the one that loses the race retries as an update, and any other failure is not swallowed", async () => {
    let n = 0;
    const racing = {
      syncCursor: {
        upsert: async () => {
          if (n++ === 0) throw Object.assign(new Error("unique"), { code: "P2002" });
          return { revision: 9n, bytes: 1 };
        },
        update: async () => null,
      },
      syncDoc: { findUnique: async () => null, upsert: async () => null },
    };
    expect(await txFor(racing as never).lockCursor("user-A")).toEqual({ revision: 9n, bytes: 1 });
    expect(n).toBe(2);
    const down = {
      syncCursor: {
        upsert: async () => {
          throw Object.assign(new Error("down"), { code: "P1001" });
        },
        update: async () => null,
      },
      syncDoc: { findUnique: async () => null, upsert: async () => null },
    };
    await expect(txFor(down as never).lockCursor("user-A")).rejects.toThrow("down");
  });

  it("writes the projection columns and nothing else of the record's content into them", async () => {
    calls.length = 0;
    await tx.put("user-A", row({ projection: { dayKey: "2026-11-20", amountMinor: 500n, kind: "expense", categoryId: "cat-food", accountId: "acc1", parentId: null, sizeBytes: null } }));
    const args = calls[0]!.args as { create: Record<string, unknown> };
    expect(Object.keys(args.create).sort()).toEqual(["accountId", "amountMinor", "bytes", "categoryId", "collection", "data", "dayKey", "deletedAt", "id", "kind", "parentId", "revision", "sizeBytes", "userId", "version"]);
    expect(args.create.dayKey).toBe("2026-11-20");
  });

  it("a deleted row is stored as a tombstone: data cleared, deletedAt set, the row kept", async () => {
    calls.length = 0;
    await tx.put("user-A", row({ data: null, deleted: true, bytes: 0 }));
    const args = calls[0]!.args as { create: { deletedAt: Date | null; data: unknown } };
    expect(args.create.deletedAt).toBeInstanceOf(Date);
    expect(String(args.create.data)).not.toContain("amount");
  });
});

describe("the in-memory fake behaves like the real repository", () => {
  it("rows and cursors are per user", async () => {
    const repo = fakeSyncRepo();
    await repo.transaction("A", async (tx) => {
      await tx.lockCursor("A");
      await tx.put("A", row());
      await tx.setCursor("A", 1n, 10);
    });
    expect((await repo.since("A", 0n, 10)).length).toBe(1);
    expect((await repo.since("B", 0n, 10)).length).toBe(0);
    expect(await repo.usage("B")).toEqual({ revision: 0n, bytes: 0, records: 0 });
  });

  it("a transaction that throws keeps nothing", async () => {
    const repo = fakeSyncRepo();
    await expect(
      repo.transaction("A", async (tx) => {
        await tx.put("A", row());
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await repo.since("A", 0n, 10)).length).toBe(0);
  });

  it("since returns rows above the revision, oldest first, at most `limit`", async () => {
    const repo = fakeSyncRepo();
    await repo.transaction("A", async (tx) => {
      for (let i = 5; i >= 1; i--) await tx.put("A", row({ id: `e${i}`, revision: BigInt(i) }));
    });
    expect((await repo.since("A", 2n, 10)).map((r) => r.id)).toEqual(["e3", "e4", "e5"]);
    expect((await repo.since("A", 0n, 2)).map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("removeAll deletes only that user's rows and cursor (account deletion)", async () => {
    const repo = fakeSyncRepo();
    for (const u of ["A", "B"]) {
      await repo.transaction(u, async (tx) => {
        await tx.lockCursor(u);
        await tx.put(u, row());
        await tx.setCursor(u, 1n, 10);
      });
    }
    expect(await repo.removeAll("A")).toEqual({ removed: 1 });
    expect((await repo.since("A", 0n, 10)).length).toBe(0);
    expect((await repo.since("B", 0n, 10)).length).toBe(1);
    expect((await repo.usage("A")).revision).toBe(0n);
  });

  it("usage does not count tombstones as records", async () => {
    const repo = fakeSyncRepo();
    await repo.transaction("A", async (tx) => {
      await tx.put("A", row({ id: "x" }));
      await tx.put("A", row({ id: "y", deleted: true, data: null }));
    });
    expect((await repo.usage("A")).records).toBe(1);
  });
});
