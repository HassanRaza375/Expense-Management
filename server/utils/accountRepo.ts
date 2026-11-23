// The Prisma implementation of AccountRepo. Every query is by the signed-in user's own id (taken from the session, never from the request).
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import type { AccountRepo } from "./accountService";

export function prismaAccountRepo(db: PrismaClient): AccountRepo {
  return {
    countSuperAdmins: () => db.user.count({ where: { role: "superadmin", disabled: false } }),
    async deleteUser(id) {
      await db.user.delete({ where: { id } }); // sessions, accounts, sync records and the cursor go with it (onDelete: Cascade)
    },
    async setAvatar(id, publicId, version) {
      await db.user.update({ where: { id }, data: { avatarPublicId: publicId, avatarVersion: version } });
    },
    async audit(e) {
      await db.auditLog.create({ data: { id: randomUUID(), action: e.action, targetType: e.targetType, targetId: e.targetId, actorId: e.actorId, actorEmail: e.actorEmail ?? null, summary: e.summary as object } });
    },
  };
}
