// The Prisma implementation of AdminRepo. READ THIS RULE before changing it: a query here may select the account's id, email, name, role and state, the sync cursor's counters, and
// the PROJECTION columns of sync records (dayKey, amountMinor, kind, categoryId, accountId, parentId, sizeBytes). It never selects `data` (notes, names, file names, the vault),
// an account's `password`, tokens, or sessions' tokens. tests/adminPrivacy.test.ts scans this file for that.
import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { useDb } from "./db";
import type { AdminRepo, AdminUser, AuditRecord, ProjRow } from "./adminTypes";

const MAX_ROWS = 500_000; // an admin report never reads more than this many projection rows

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  disabled: true,
  emailVerified: true,
  createdAt: true,
  syncCursor: { select: { updatedAt: true, bytes: true } },
  _count: { select: { syncDocs: { where: { deletedAt: null } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const toUser = (u: UserRow): AdminUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  disabled: u.disabled,
  emailVerified: u.emailVerified,
  createdAt: u.createdAt,
  lastSyncAt: u.syncCursor?.updatedAt ?? null,
  records: u._count.syncDocs,
  bytes: u.syncCursor?.bytes ?? 0,
});

export const prismaAdminRepo = (): AdminRepo => {
  const db = () => useDb();
  return {
    async listUsers({ search, role, status, skip, take }) {
      const where: Prisma.UserWhereInput = {
        ...(role ? { role } : {}),
        ...(status ? { disabled: status === "disabled" } : {}),
        ...(search ? { OR: [{ email: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }] } : {}),
      };
      const [rows, total] = await Promise.all([db().user.findMany({ where, select: USER_SELECT, orderBy: { email: "asc" }, skip, take }), db().user.count({ where })]);
      return { users: rows.map(toUser), total };
    },
    async getUser(id) {
      const u = await db().user.findUnique({ where: { id }, select: USER_SELECT });
      return u ? toUser(u) : null;
    },
    async countsByCollection(userId) {
      const g = await db().syncDoc.groupBy({ by: ["collection"], where: { userId, deletedAt: null }, _count: { _all: true } });
      return Object.fromEntries(g.map((r) => [r.collection, r._count._all]));
    },
    async rows({ userId, collections }): Promise<ProjRow[]> {
      return db().syncDoc.findMany({
        where: { deletedAt: null, collection: { in: collections }, ...(userId ? { userId } : {}) },
        select: { userId: true, collection: true, dayKey: true, amountMinor: true, kind: true, categoryId: true, accountId: true, parentId: true, sizeBytes: true },
        take: MAX_ROWS,
      });
    },
    superAdminCount: () => db().user.count({ where: { role: "superadmin", disabled: false } }),
    async emailTaken(email, exceptId) {
      return (await db().user.count({ where: { email: { equals: email, mode: "insensitive" }, NOT: { id: exceptId } } })) > 0;
    },
    async updateUser(id, patch) {
      await db().user.update({ where: { id }, data: patch });
    },
    async revokeSessions(id) {
      await db().session.deleteMany({ where: { userId: id } });
    },
    async deleteUser(id) {
      await db().user.delete({ where: { id } }); // sessions, sign-in methods, sync records and the cursor go with it (onDelete: Cascade)
      await db().rateLimit.deleteMany({ where: { key: { startsWith: "api:", endsWith: `:${id}` } } }); // the account's API request counters
    },
    async audit(e) {
      await db().auditLog.create({ data: { id: randomUUID(), actorId: e.actorId, actorEmail: e.actorEmail, action: e.action, targetType: e.targetType, targetId: e.targetId, summary: e.summary as Prisma.InputJsonValue } });
    },
    async listAudit({ skip, take }) {
      const [rows, total] = await Promise.all([db().auditLog.findMany({ orderBy: { at: "desc" }, skip, take }), db().auditLog.count()]);
      return { entries: rows as AuditRecord[], total };
    },
    async overview() {
      const week = new Date(Date.now() - 7 * 86_400_000);
      const [users, superAdmins, disabled, active, records, bytes] = await Promise.all([
        db().user.count(),
        db().user.count({ where: { role: "superadmin" } }),
        db().user.count({ where: { disabled: true } }),
        db().syncCursor.count({ where: { updatedAt: { gte: week } } }),
        db().syncDoc.count({ where: { deletedAt: null } }),
        db().syncCursor.aggregate({ _sum: { bytes: true } }),
      ]);
      return { users, superAdmins, disabled, activeLast7Days: active, records, bytes: bytes._sum.bytes ?? 0 };
    },
  };
};
