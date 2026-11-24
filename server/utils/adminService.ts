// What the super admin can see and do. Pure logic over AdminRepo, so unit tests run the REAL rules with an in-memory repository.
//
// SEEING: only projection columns. Monthly and yearly totals group by the day key the CLIENT computed (`dayKey.slice(0, 7)`), never by a timestamp, so they equal what the user's
// own app shows. Money is integer minor units all the way (summed as bigint) and only turned into a number at the edge.
// DOING: every write is recorded in the audit log (who, what, when, a before/after summary of NON-private fields). Nobody can delete, demote or disable themselves, and the
// last enabled super admin can be neither demoted, disabled nor deleted. Deleting a user needs their email typed exactly.
import { ServiceError } from "./accountService";
import { userPrefix, type MediaStore } from "./media";
import type { AdminRepo, AdminUser, ProjRow } from "./adminTypes";

export interface Actor {
  id: string;
  email: string;
}

export interface AdminDeps {
  repo: AdminRepo;
  media: MediaStore | null;
  /** sends the password-reset email through Better Auth; null while email is not set up */
  sendReset: ((email: string) => Promise<void>) | null;
}

// ---------------------------------------------------------------- aggregation (pure)

const num = (b: bigint): number => Number(b);
const UNDATED = "undated";
export const monthOfRow = (r: ProjRow): string => (r.dayKey ? r.dayKey.slice(0, 7) : UNDATED);
export const yearOfRow = (r: ProjRow): string => (r.dayKey ? r.dayKey.slice(0, 4) : UNDATED);

function sumBy<K extends string>(rows: ProjRow[], key: (r: ProjRow) => K, pick: (r: ProjRow) => boolean = () => true): Map<K, bigint> {
  const out = new Map<K, bigint>();
  for (const r of rows) if (pick(r) && r.amountMinor !== null) out.set(key(r), (out.get(key(r)) ?? 0n) + r.amountMinor);
  return out;
}

export interface ExpenseMonth {
  month: string;
  gross: number;
  refunds: number;
  net: number;
  count: number;
}

/** Expenses by month: gross (ordinary expenses), refunds (kind `refund`, a positive amount), and net = gross - refunds: the same arithmetic as the app's own summary. */
export function expenseSummary(rows: ProjRow[]) {
  const ex = rows.filter((r) => r.collection === "expense");
  const gross = sumBy(ex, monthOfRow, (r) => r.kind !== "refund");
  const refunds = sumBy(ex, monthOfRow, (r) => r.kind === "refund");
  const counts = new Map<string, number>();
  for (const r of ex) counts.set(monthOfRow(r), (counts.get(monthOfRow(r)) ?? 0) + 1);
  const months = [...new Set([...gross.keys(), ...refunds.keys(), ...counts.keys()])].sort();
  const byMonth: ExpenseMonth[] = months.map((m) => ({ month: m, gross: num(gross.get(m) ?? 0n), refunds: num(refunds.get(m) ?? 0n), net: num((gross.get(m) ?? 0n) - (refunds.get(m) ?? 0n)), count: counts.get(m) ?? 0 }));
  const cat = new Map<string, bigint>();
  for (const r of ex) if (r.amountMinor !== null) cat.set(r.categoryId ?? "(none)", (cat.get(r.categoryId ?? "(none)") ?? 0n) + (r.kind === "refund" ? -r.amountMinor : r.amountMinor));
  const byCategory = [...cat].map(([categoryId, v]) => ({ categoryId, net: num(v) })).sort((a, b) => b.net - a.net);
  const years = [...new Set(ex.map(yearOfRow))].sort().map((y) => {
    const g = ex.filter((r) => yearOfRow(r) === y && r.kind !== "refund").reduce((n, r) => n + (r.amountMinor ?? 0n), 0n);
    const f = ex.filter((r) => yearOfRow(r) === y && r.kind === "refund").reduce((n, r) => n + (r.amountMinor ?? 0n), 0n);
    return { year: y, net: num(g - f) };
  });
  return { byMonth, byCategory, byYear: years, total: byMonth.reduce((n, m) => n + m.net, 0), count: ex.length };
}

/** Income by month and by kind, and the cash flow (income minus the expenses' net) per month. */
export function incomeSummary(rows: ProjRow[]) {
  const inc = rows.filter((r) => r.collection === "income");
  const byMonth = sumBy(inc, monthOfRow);
  const exp = expenseSummary(rows);
  const expByMonth = new Map(exp.byMonth.map((m) => [m.month, m.net]));
  const months = [...new Set([...byMonth.keys(), ...expByMonth.keys()])].sort();
  const kinds = new Map<string, bigint>();
  for (const r of inc) if (r.amountMinor !== null) kinds.set(r.kind ?? "(none)", (kinds.get(r.kind ?? "(none)") ?? 0n) + r.amountMinor);
  return {
    byMonth: months.map((m) => ({ month: m, income: num(byMonth.get(m) ?? 0n), expenses: expByMonth.get(m) ?? 0, net: num(byMonth.get(m) ?? 0n) - (expByMonth.get(m) ?? 0) })),
    byKind: [...kinds].map(([kind, v]) => ({ kind, total: num(v) })).sort((a, b) => b.total - a.total),
    total: num([...byMonth.values()].reduce((n, v) => n + v, 0n)),
    count: inc.length,
  };
}

/** Investments: money put in and taken out by month, and per fund (contributions minus withdrawals), with the latest value entry. */
export function investmentSummary(rows: ProjRow[]) {
  const put = rows.filter((r) => r.collection === "fundContribution");
  const out = rows.filter((r) => r.collection === "fundWithdrawal");
  const values = rows.filter((r) => r.collection === "fundValue");
  const inM = sumBy(put, monthOfRow);
  const outM = sumBy(out, monthOfRow);
  const months = [...new Set([...inM.keys(), ...outM.keys()])].sort();
  const perFund = new Map<string, { put: bigint; out: bigint; value: bigint | null; valueDay: string }>();
  const f = (id: string) => perFund.get(id) ?? perFund.set(id, { put: 0n, out: 0n, value: null, valueDay: "" }).get(id)!;
  for (const r of put) f(r.parentId ?? "(none)").put += r.amountMinor ?? 0n;
  for (const r of out) f(r.parentId ?? "(none)").out += r.amountMinor ?? 0n;
  for (const r of values) {
    const e = f(r.parentId ?? "(none)");
    if ((r.dayKey ?? "") >= e.valueDay && r.amountMinor !== null) {
      e.value = r.amountMinor;
      e.valueDay = r.dayKey ?? "";
    }
  }
  return {
    funds: rows.filter((r) => r.collection === "fund").length,
    byMonth: months.map((m) => ({ month: m, contributed: num(inM.get(m) ?? 0n), withdrawn: num(outM.get(m) ?? 0n) })),
    perFund: [...perFund].map(([fundId, e]) => ({ fundId, contributed: num(e.put), withdrawn: num(e.out), netIn: num(e.put - e.out), latestValue: e.value === null ? null : num(e.value) })),
    contributed: num([...inM.values()].reduce((n, v) => n + v, 0n)),
    withdrawn: num([...outM.values()].reduce((n, v) => n + v, 0n)),
  };
}

/** Receipts: how many and how many bytes, per user and in total. Sizes only: never a name, never an image. */
export function storageSummary(rows: ProjRow[], users: Array<Pick<AdminUser, "id" | "email" | "bytes" | "records">>) {
  const rec = rows.filter((r) => r.collection === "receipt");
  const per = new Map<string, { count: number; bytes: bigint }>();
  for (const r of rec) {
    const e = per.get(r.userId) ?? { count: 0, bytes: 0n };
    e.count++;
    e.bytes += r.sizeBytes ?? 0n;
    per.set(r.userId, e);
  }
  const perUser = users.map((u) => ({ userId: u.id, email: u.email, receipts: per.get(u.id)?.count ?? 0, receiptBytes: num(per.get(u.id)?.bytes ?? 0n), recordBytes: u.bytes, records: u.records })).sort((a, b) => b.receiptBytes + b.recordBytes - (a.receiptBytes + a.recordBytes));
  return { receipts: rec.length, receiptBytes: perUser.reduce((n, u) => n + u.receiptBytes, 0), recordBytes: perUser.reduce((n, u) => n + u.recordBytes, 0), perUser };
}

// ---------------------------------------------------------------- reading

const EXPENSE_COLLECTIONS = ["expense"];
const INCOME_COLLECTIONS = ["income", "expense"]; // cash flow needs both

export const adminOverview = async ({ repo }: AdminDeps) => ({ ...(await repo.overview()), expenses: expenseSummary(await repo.rows({ collections: EXPENSE_COLLECTIONS })).byMonth.slice(-12) });

export async function adminUsers({ repo }: AdminDeps, q: { search?: string; role?: string; status?: string; page?: number }) {
  const take = 25;
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const role = q.role === "user" || q.role === "superadmin" ? q.role : undefined;
  const status = q.status === "enabled" || q.status === "disabled" ? q.status : undefined;
  const r = await repo.listUsers({ search: q.search?.trim().slice(0, 100) || undefined, role, status, skip: (page - 1) * take, take });
  return { users: r.users, total: r.total, page, pages: Math.max(1, Math.ceil(r.total / take)) };
}

export async function adminUserDetail({ repo }: AdminDeps, id: string) {
  const user = await repo.getUser(id);
  if (!user) throw new ServiceError(404, "user_not_found");
  const rows = await repo.rows({ userId: id, collections: ["expense", "income", "fundContribution", "fundWithdrawal", "fundValue", "fund", "receipt"] });
  return { user, counts: await repo.countsByCollection(id), expenses: expenseSummary(rows), income: incomeSummary(rows), investments: investmentSummary(rows), storage: storageSummary(rows, [user]).perUser[0] };
}

export const adminExpenses = async ({ repo }: AdminDeps, userId?: string) => expenseSummary(await repo.rows({ userId, collections: EXPENSE_COLLECTIONS }));
export const adminIncome = async ({ repo }: AdminDeps, userId?: string) => incomeSummary(await repo.rows({ userId, collections: INCOME_COLLECTIONS }));
export const adminInvestments = async ({ repo }: AdminDeps, userId?: string) => investmentSummary(await repo.rows({ userId, collections: ["fund", "fundContribution", "fundWithdrawal", "fundValue"] }));

export async function adminStorage({ repo }: AdminDeps) {
  const all = await repo.listUsers({ skip: 0, take: 1000 });
  return storageSummary(await repo.rows({ collections: ["receipt"] }), all.users);
}

export async function adminAudit({ repo }: AdminDeps, page = 1) {
  const take = 50;
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const r = await repo.listAudit({ skip: (p - 1) * take, take });
  return { entries: r.entries, total: r.total, page: p, pages: Math.max(1, Math.ceil(r.total / take)) };
}

// ---------------------------------------------------------------- writing (always audited)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const brief = (u: AdminUser) => ({ name: u.name, email: u.email, role: u.role, disabled: u.disabled });

export interface UserPatch {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  disabled?: unknown;
}

export async function updateUser({ repo }: AdminDeps, actor: Actor, id: string, patch: UserPatch) {
  const before = await repo.getUser(id);
  if (!before) throw new ServiceError(404, "user_not_found");
  const next: { name?: string; email?: string; role?: string; disabled?: boolean } = {};
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || !patch.name.trim() || patch.name.trim().length > 80) throw new ServiceError(400, "invalid_name");
    next.name = patch.name.trim();
  }
  if (patch.email !== undefined) {
    const e = typeof patch.email === "string" ? patch.email.trim().toLowerCase() : "";
    if (!EMAIL.test(e) || e.length > 254) throw new ServiceError(400, "invalid_email");
    if (e !== before.email && (await repo.emailTaken(e, id))) throw new ServiceError(409, "email_taken");
    next.email = e;
  }
  if (patch.role !== undefined) {
    if (patch.role !== "user" && patch.role !== "superadmin") throw new ServiceError(400, "invalid_role");
    next.role = patch.role;
  }
  if (patch.disabled !== undefined) {
    if (typeof patch.disabled !== "boolean") throw new ServiceError(400, "invalid_state");
    next.disabled = patch.disabled;
  }
  const losesAdmin = (next.role !== undefined && next.role !== "superadmin" && before.role === "superadmin") || (next.disabled === true && before.role === "superadmin" && !before.disabled);
  if (actor.id === id && (next.role !== undefined && next.role !== before.role ? true : next.disabled === true)) throw new ServiceError(409, "cannot_change_self");
  if (losesAdmin && !before.disabled && (await repo.superAdminCount()) <= 1) throw new ServiceError(409, "last_super_admin");
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => (before as unknown as Record<string, unknown>)[k] !== v));
  if (Object.keys(changed).length === 0) return { user: before, changed: [] as string[] };
  await repo.updateUser(id, changed);
  if (changed.disabled === true) await repo.revokeSessions(id); // a disabled account is signed out everywhere at once
  const after = (await repo.getUser(id)) ?? before;
  // one audit entry for each kind of change, so a role change and a disable made together are both on record
  const actions = [
    ...("role" in changed ? ["user.role"] : []),
    ...("disabled" in changed ? [changed.disabled ? "user.disable" : "user.enable"] : []),
    ...("name" in changed || "email" in changed ? ["user.update"] : []),
  ];
  for (const action of actions) await repo.audit({ actorId: actor.id, actorEmail: actor.email, action, targetType: "user", targetId: id, summary: { before: brief(before), after: brief(after) } });
  return { user: after, changed: Object.keys(changed) };
}

export async function deleteUser({ repo, media }: AdminDeps, actor: Actor, id: string, confirm: unknown) {
  const user = await repo.getUser(id);
  if (!user) throw new ServiceError(404, "user_not_found");
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== user.email.toLowerCase()) throw new ServiceError(400, "confirmation_mismatch");
  if (actor.id === id) throw new ServiceError(409, "cannot_change_self");
  if (user.role === "superadmin" && !user.disabled && (await repo.superAdminCount()) <= 1) throw new ServiceError(409, "last_super_admin");
  const counts = await repo.countsByCollection(id);
  await repo.deleteUser(id);
  let cleanup: "done" | "failed" | "skipped" = "skipped";
  if (media) {
    try {
      await media.deleteByPrefix(userPrefix(media.root, id));
      cleanup = "done";
    } catch {
      cleanup = "failed"; // the account is gone; the folder is named in the log below so it can be removed by hand
    }
  }
  await repo.audit({ actorId: actor.id, actorEmail: actor.email, action: "user.delete", targetType: "user", targetId: id, summary: { before: brief(user), records: Object.values(counts).reduce((n, v) => n + v, 0), files: cleanup, ...(cleanup === "failed" ? { prefix: userPrefix(media!.root, id) } : {}) } });
  return { deleted: true as const, cleanup };
}

export async function sendResetEmail({ repo, sendReset }: AdminDeps, actor: Actor, id: string) {
  const user = await repo.getUser(id);
  if (!user) throw new ServiceError(404, "user_not_found");
  if (!sendReset) throw new ServiceError(503, "email_not_set_up");
  await sendReset(user.email);
  await repo.audit({ actorId: actor.id, actorEmail: actor.email, action: "user.reset_email", targetType: "user", targetId: id, summary: { email: user.email } });
  return { sent: true as const };
}
