// An in-memory AdminRepo over the in-memory sync repository (tests/fakes/syncRepo.ts): the same projection rows the real database would hold, users, and an audit log.
import type { AdminRepo, AdminUser, AuditRecord, ProjRow } from "../../server/utils/adminTypes";
import type { fakeSyncRepo } from "./syncRepo";

export interface FakeAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: Date;
  lastSyncAt: Date | null;
  sessions: number;
}

export function fakeAdminRepo(sync: ReturnType<typeof fakeSyncRepo>) {
  const accounts = new Map<string, FakeAccount>();
  const auditLog: AuditRecord[] = [];
  const deleted: string[] = [];
  let n = 0;

  const view = (a: FakeAccount): AdminUser => {
    const c = sync.state.cursors.get(a.id);
    const records = [...sync.state.rows].filter(([k, r]) => k.startsWith(`${a.id}\u0000`) && !r.deleted).length;
    return { id: a.id, email: a.email, name: a.name, role: a.role, disabled: a.disabled, emailVerified: a.emailVerified, createdAt: a.createdAt, lastSyncAt: a.lastSyncAt, records, bytes: c?.bytes ?? 0 };
  };

  const repo: AdminRepo & { accounts: Map<string, FakeAccount>; auditLog: AuditRecord[]; deleted: string[]; add(a: Partial<FakeAccount> & { id: string; email: string }): FakeAccount } = {
    accounts,
    auditLog,
    deleted,
    add(a) {
      const acc: FakeAccount = { name: a.email.split("@")[0]!, role: "user", disabled: false, emailVerified: true, createdAt: new Date(2026, 0, 1 + n++), lastSyncAt: null, sessions: 1, ...a };
      accounts.set(acc.id, acc);
      return acc;
    },
    async listUsers({ search, role, status, skip, take }) {
      let list = [...accounts.values()];
      if (search) list = list.filter((a) => a.email.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase()));
      if (role) list = list.filter((a) => a.role === role);
      if (status) list = list.filter((a) => a.disabled === (status === "disabled"));
      list.sort((a, b) => a.email.localeCompare(b.email));
      return { users: list.slice(skip, skip + take).map(view), total: list.length };
    },
    async getUser(id) {
      const a = accounts.get(id);
      return a ? view(a) : null;
    },
    async countsByCollection(userId) {
      const out: Record<string, number> = {};
      for (const [k, r] of sync.state.rows) if (k.startsWith(`${userId}\u0000`) && !r.deleted) out[r.collection] = (out[r.collection] ?? 0) + 1;
      return out;
    },
    async rows({ userId, collections }) {
      const out: ProjRow[] = [];
      for (const [k, r] of sync.state.rows) {
        const uid = k.split("\u0000")[0]!;
        if (r.deleted || !collections.includes(r.collection) || (userId && uid !== userId)) continue;
        const p = r.projection;
        out.push({ userId: uid, collection: r.collection, dayKey: p.dayKey ?? null, amountMinor: p.amountMinor ?? null, kind: p.kind ?? null, categoryId: p.categoryId ?? null, accountId: p.accountId ?? null, parentId: p.parentId ?? null, sizeBytes: p.sizeBytes ?? null });
      }
      return out;
    },
    async superAdminCount() {
      return [...accounts.values()].filter((a) => a.role === "superadmin" && !a.disabled).length;
    },
    async emailTaken(email, exceptId) {
      return [...accounts.values()].some((a) => a.email.toLowerCase() === email.toLowerCase() && a.id !== exceptId);
    },
    async updateUser(id, patch) {
      Object.assign(accounts.get(id)!, patch);
    },
    async revokeSessions(id) {
      accounts.get(id)!.sessions = 0;
    },
    async deleteUser(id) {
      accounts.delete(id);
      deleted.push(id);
      await sync.removeAll(id);
    },
    async audit(e) {
      auditLog.unshift({ id: `a${auditLog.length + 1}`, at: new Date(), ...e });
    },
    async listAudit({ skip, take }) {
      return { entries: auditLog.slice(skip, skip + take), total: auditLog.length };
    },
    async overview() {
      const all = [...accounts.values()];
      const week = Date.now() - 7 * 86_400_000;
      return {
        users: all.length,
        superAdmins: all.filter((a) => a.role === "superadmin").length,
        disabled: all.filter((a) => a.disabled).length,
        activeLast7Days: all.filter((a) => a.lastSyncAt && a.lastSyncAt.getTime() >= week).length,
        records: [...sync.state.rows.values()].filter((r) => !r.deleted).length,
        bytes: [...sync.state.cursors.values()].reduce((s, c) => s + c.bytes, 0),
      };
    },
  };
  return repo;
}
