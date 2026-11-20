// The Prisma implementation of `SyncRepo`. Every query is scoped by `userId` (tests/syncRepo.test.ts checks that with a recording client).
import { Prisma } from "../generated/prisma/client";
import { useDb } from "./db";
import type { Row, SyncRepo, Tx } from "./syncTypes";

type Db = Pick<Prisma.TransactionClient, "syncDoc" | "syncCursor" | "$queryRaw">;

type DocRow = {
  collection: string;
  id: string;
  data: unknown;
  version: number;
  revision: bigint;
  deletedAt: Date | null;
  bytes: number;
  parentId: string | null;
  dayKey: string | null;
  amountMinor: bigint | null;
  kind: string | null;
  categoryId: string | null;
  accountId: string | null;
  sizeBytes: bigint | null;
};

const toRow = (r: DocRow): Row => ({
  collection: r.collection,
  id: r.id,
  data: r.data ?? null,
  version: r.version,
  revision: r.revision,
  deleted: r.deletedAt !== null,
  bytes: r.bytes,
  projection: { parentId: r.parentId, dayKey: r.dayKey, amountMinor: r.amountMinor, kind: r.kind, categoryId: r.categoryId, accountId: r.accountId, sizeBytes: r.sizeBytes },
});

export const txFor = (db: Db): Tx => ({
  async lockCursor(userId) {
    await db.syncCursor.upsert({ where: { userId }, create: { userId }, update: {} });
    const rows = await db.$queryRaw<{ revision: bigint; bytes: number }[]>`SELECT "revision", "bytes" FROM "SyncCursor" WHERE "userId" = ${userId} FOR UPDATE`;
    return { revision: BigInt(rows[0]?.revision ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
  },
  async record(userId, collection, id) {
    const r = await db.syncDoc.findUnique({ where: { userId_collection_id: { userId, collection, id } } });
    return r ? toRow(r as DocRow) : null;
  },
  async put(userId, row) {
    const data = row.data === null ? Prisma.DbNull : (row.data as Prisma.InputJsonValue);
    const p = row.projection;
    const fields = {
      data,
      version: row.version,
      revision: row.revision,
      deletedAt: row.deleted ? new Date() : null,
      bytes: row.bytes,
      parentId: p.parentId ?? null,
      dayKey: p.dayKey ?? null,
      amountMinor: p.amountMinor ?? null,
      kind: p.kind ?? null,
      categoryId: p.categoryId ?? null,
      accountId: p.accountId ?? null,
      sizeBytes: p.sizeBytes ?? null,
    };
    await db.syncDoc.upsert({
      where: { userId_collection_id: { userId, collection: row.collection, id: row.id } },
      create: { userId, collection: row.collection, id: row.id, ...fields },
      update: fields,
    });
  },
  async setCursor(userId, revision, bytes) {
    await db.syncCursor.update({ where: { userId }, data: { revision, bytes } });
  },
});

export const prismaSyncRepo = (): SyncRepo => {
  const db = () => useDb();
  return {
    transaction: (_userId, fn) => db().$transaction(async (t) => fn(txFor(t)), { timeout: 15_000, maxWait: 5_000 }),
    async since(userId, since, limit) {
      const rows = await db().syncDoc.findMany({ where: { userId, revision: { gt: since } }, orderBy: { revision: "asc" }, take: limit });
      return rows.map((r) => toRow(r as DocRow));
    },
    async removeAll(userId) {
      const r = await db().$transaction([db().syncDoc.deleteMany({ where: { userId } }), db().syncCursor.deleteMany({ where: { userId } })]);
      return { removed: r[0].count };
    },
    async usage(userId) {
      const [c, n] = await Promise.all([db().syncCursor.findUnique({ where: { userId } }), db().syncDoc.count({ where: { userId, deletedAt: null } })]);
      return { revision: c?.revision ?? 0n, bytes: c?.bytes ?? 0, records: n };
    },
  };
};
