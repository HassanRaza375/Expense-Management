import { describe, expect, it, vi } from "vitest";
import { dayKeyOf } from "../app/lib/sync/plan";
import { COLLECTION_BY_NAME } from "../app/lib/sync/collections";
import { adminAudit, adminExpenses, adminIncome, adminInvestments, adminOverview, adminStorage, adminUserDetail, adminUsers, deleteUser, sendResetEmail, updateUser, type AdminDeps } from "../server/utils/adminService";
import type { MediaStore } from "../server/utils/media";
import { applyPush } from "../server/utils/syncService";
import { fakeAdminRepo } from "./fakes/adminRepo";
import { fakeSyncRepo } from "./fakes/syncRepo";
// @ts-expect-error plain JS module (the app's own arithmetic)
import { localDayKey, summarize } from "../app/utils/reporting.js";

const ROOT = { id: "root", email: "root@example.test" };
function world() {
  const sync = fakeSyncRepo();
  const repo = fakeAdminRepo(sync);
  repo.add({ id: "root", email: "root@example.test", role: "superadmin" });
  repo.add({ id: "u1", email: "ann@example.test" });
  repo.add({ id: "u2", email: "bob@example.test" });
  const removed: string[] = [];
  const media = { cloudName: "c", root: "hisaab-test", deleteByPrefix: vi.fn(async (p: string) => (removed.push(p), 2)) } as unknown as MediaStore;
  const deps: AdminDeps = { repo, media, sendReset: null };
  const put = (user: string, collection: string, id: string, data: Record<string, unknown>, dayKey: string | null = null) => applyPush(sync, user, { ops: [{ collection, id, base: 0, put: { id, ...data }, dayKey }] });
  return { sync, repo, deps, removed, media, put };
}

describe("the admin sees projection columns only", () => {
  it("monthly totals group by the day key the client sent, in integer minor units, refunds subtracted", async () => {
    const w = world();
    await w.put("u1", "expense", "a", { amount: 100.5, categoryId: "food", note: "SECRET NOTE" }, "2026-10-31");
    await w.put("u1", "expense", "b", { amount: 20, categoryId: "food" }, "2026-11-01");
    await w.put("u1", "expense", "c", { amount: 5.25, categoryId: "fun", kind: "refund" }, "2026-11-02");
    await w.put("u2", "expense", "d", { amount: 10, categoryId: "fun" }, "2026-11-15");
    const mine = await adminExpenses(w.deps, "u1");
    expect(mine.byMonth).toEqual([
      { month: "2026-10", gross: 10050, refunds: 0, net: 10050, count: 1 },
      { month: "2026-11", gross: 2000, refunds: 525, net: 1475, count: 2 },
    ]);
    expect(mine.byCategory).toEqual([{ categoryId: "food", net: 12050 }, { categoryId: "fun", net: -525 }]);
    const everyone = await adminExpenses(w.deps);
    expect(everyone.byMonth.find((m) => m.month === "2026-11")).toMatchObject({ gross: 3000, net: 2475, count: 3 });
    expect(JSON.stringify(everyone)).not.toContain("SECRET");
    expect(everyone.byYear).toEqual([{ year: "2026", net: 12525 }]); // 10050 + 2000 + 1000 - 525
  });

  it("a record with no day key is its own 'undated' bucket (the server never invents a day)", async () => {
    const w = world();
    await w.put("u1", "expense", "x", { amount: 7 }, null);
    expect((await adminExpenses(w.deps, "u1")).byMonth).toEqual([{ month: "undated", gross: 700, refunds: 0, net: 700, count: 1 }]);
  });

  it("income, cash flow, investments and storage", async () => {
    const w = world();
    await w.put("u1", "income", "i1", { amount: 5000, sourceType: "salary" }, "2026-11-03");
    await w.put("u1", "income", "i2", { amount: 100, sourceType: "gift" }, "2026-10-03");
    await w.put("u1", "expense", "e1", { amount: 1200 }, "2026-11-04");
    const inc = await adminIncome(w.deps, "u1");
    expect(inc.byMonth).toEqual([
      { month: "2026-10", income: 10000, expenses: 0, net: 10000 },
      { month: "2026-11", income: 500000, expenses: 120000, net: 380000 },
    ]);
    expect(inc.byKind).toEqual([{ kind: "salary", total: 500000 }, { kind: "gift", total: 10000 }]);
    await w.put("u1", "fund", "f1", { name: "Index fund SECRET" });
    await w.put("u1", "fundContribution", "c1", { fundId: "f1", amount: 1000 }, "2026-09-02");
    await w.put("u1", "fundContribution", "c2", { fundId: "f1", amount: 500 }, "2026-10-02");
    await w.put("u1", "fundWithdrawal", "w1", { fundId: "f1", amount: 400 }, "2026-11-02");
    await w.put("u1", "fundValue", "v1", { fundId: "f1", value: 1300 }, "2026-10-20");
    await w.put("u1", "fundValue", "v2", { fundId: "f1", value: 1450 }, "2026-11-20");
    const inv = await adminInvestments(w.deps, "u1");
    expect(inv.perFund).toEqual([{ fundId: "f1", contributed: 150000, withdrawn: 40000, netIn: 110000, latestValue: 145000 }]);
    expect(inv.byMonth).toEqual([{ month: "2026-09", contributed: 100000, withdrawn: 0 }, { month: "2026-10", contributed: 50000, withdrawn: 0 }, { month: "2026-11", contributed: 0, withdrawn: 40000 }]);
    expect(JSON.stringify(inv)).not.toContain("SECRET");
    await w.put("u1", "expense", "ee", { amount: 1 }, "2026-11-05");
    await w.put("u1", "receipt", "r1", { expenseId: "ee", filename: "private-name.jpg", mimeType: "image/jpeg", size: 2048 });
    await w.put("u1", "receipt", "r2", { expenseId: "ee", filename: "other.pdf", mimeType: "application/pdf", size: 1000 });
    const st = await adminStorage(w.deps);
    expect(st.receipts).toBe(2);
    expect(st.receiptBytes).toBe(3048);
    expect(st.perUser.find((u) => u.userId === "u1")).toMatchObject({ receipts: 2, receiptBytes: 3048 });
    expect(JSON.stringify(st)).not.toMatch(/private-name|other\.pdf|image\/jpeg/); // sizes and counts only
  });

  it("a user's numbers equal what the user's own app shows (the same arithmetic on the same records, in every time zone)", async () => {
    const w = world();
    const spec = COLLECTION_BY_NAME.expense!;
    // local-noon records, old UTC-midnight records, refunds, awkward decimals, across a month boundary
    const records = [
      { id: "1", date: new Date(2026, 9, 31, 12).toISOString(), amount: 0.1 + 0.2, categoryId: "a" },
      { id: "2", date: new Date(2026, 10, 1, 12).toISOString(), amount: 1200.5, categoryId: "a" },
      { id: "3", date: new Date(2026, 10, 1, 12).toISOString(), amount: 99.99, categoryId: "b", kind: "refund" },
      { id: "4", date: "2026-11-02T00:00:00.000Z", amount: 3, categoryId: "b" },
      { id: "5", date: new Date(2026, 10, 30, 23, 30).toISOString(), amount: 18.75, categoryId: "a" },
      { id: "6", date: new Date(2026, 11, 1, 0, 30).toISOString(), amount: 4.4, categoryId: "c" },
    ];
    for (const r of records) await w.put("u1", "expense", r.id, r, dayKeyOf(spec, r));
    const admin = await adminExpenses(w.deps, "u1");
    for (const m of ["2026-10", "2026-11", "2026-12"]) {
      const list = records.filter((r) => localDayKey(r.date).startsWith(m));
      const app = summarize(list);
      const row = admin.byMonth.find((x) => x.month === m)!;
      expect(row.net / 100, m).toBeCloseTo(app.net, 6);
      expect(row.gross / 100, m).toBeCloseTo(app.gross, 6);
      expect(row.refunds / 100, m).toBeCloseTo(app.refunds, 6);
      expect(row.count).toBe(list.length);
    }
  });
});

describe("users", () => {
  it("search, role and status filters, paging, and no secret fields", async () => {
    const w = world();
    for (let i = 0; i < 30; i++) w.repo.add({ id: `x${i}`, email: `user${String(i).padStart(2, "0")}@example.test`, disabled: i % 2 === 0 });
    const p1 = await adminUsers(w.deps, { page: 1 });
    expect(p1.users).toHaveLength(25);
    expect(p1.pages).toBe(2);
    expect((await adminUsers(w.deps, { page: 2 })).users).toHaveLength(8);
    expect((await adminUsers(w.deps, { search: "USER07" })).users.map((u) => u.id)).toEqual(["x7"]);
    expect((await adminUsers(w.deps, { role: "superadmin" })).users.map((u) => u.id)).toEqual(["root"]);
    expect((await adminUsers(w.deps, { status: "disabled" })).total).toBe(15);
    expect((await adminUsers(w.deps, { page: -5 })).page).toBe(1);
    expect((await adminUsers(w.deps, { role: "whatever", status: "nonsense" })).total).toBe(33); // unknown filter values are ignored
    for (const u of p1.users) expect(Object.keys(u).sort()).toEqual(["bytes", "createdAt", "disabled", "email", "emailVerified", "id", "lastSyncAt", "name", "records", "role"]);
  });

  it("the detail has counts and totals, and a missing user is 404", async () => {
    const w = world();
    await w.put("u1", "expense", "e", { amount: 5 }, "2026-11-01");
    const d = await adminUserDetail(w.deps, "u1");
    expect(d.counts).toEqual({ expense: 1 });
    expect(d.expenses.total).toBe(500);
    await expect(adminUserDetail(w.deps, "nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("the overview counts users, admins, disabled and active accounts", async () => {
    const w = world();
    w.repo.accounts.get("u1")!.disabled = true;
    w.repo.accounts.get("u2")!.lastSyncAt = new Date();
    await w.put("u2", "expense", "e", { amount: 5 }, "2026-11-01");
    expect(await adminOverview(w.deps)).toMatchObject({ users: 3, superAdmins: 1, disabled: 1, activeLast7Days: 1, records: 1 });
  });
});

describe("every write is audited, and the guards hold", () => {
  it("editing a user records before and after (non-private fields), and a no-op records nothing", async () => {
    const w = world();
    const r = await updateUser(w.deps, ROOT, "u1", { name: "Ann Lee", email: "ANN.LEE@example.test" });
    expect(r.changed.sort()).toEqual(["email", "name"]);
    expect(w.repo.accounts.get("u1")).toMatchObject({ name: "Ann Lee", email: "ann.lee@example.test" });
    expect(w.repo.auditLog).toHaveLength(1);
    expect(w.repo.auditLog[0]).toMatchObject({ actorId: "root", actorEmail: "root@example.test", action: "user.update", targetType: "user", targetId: "u1" });
    expect(JSON.stringify(w.repo.auditLog[0]!.summary)).not.toMatch(/password|token|hash/i);
    expect((await updateUser(w.deps, ROOT, "u1", { name: "Ann Lee" })).changed).toEqual([]);
    expect(w.repo.auditLog).toHaveLength(1);
  });

  it("validates what it is given", async () => {
    const w = world();
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { status: number; code: string }) => `${e.status}:${e.code}`);
    expect(await code(updateUser(w.deps, ROOT, "u1", { name: "" }))).toBe("400:invalid_name");
    expect(await code(updateUser(w.deps, ROOT, "u1", { name: "x".repeat(81) }))).toBe("400:invalid_name");
    expect(await code(updateUser(w.deps, ROOT, "u1", { email: "not an email" }))).toBe("400:invalid_email");
    expect(await code(updateUser(w.deps, ROOT, "u1", { email: "bob@example.test" }))).toBe("409:email_taken");
    expect(await code(updateUser(w.deps, ROOT, "u1", { role: "god" }))).toBe("400:invalid_role");
    expect(await code(updateUser(w.deps, ROOT, "u1", { disabled: "yes" }))).toBe("400:invalid_state");
    expect(await code(updateUser(w.deps, ROOT, "ghost", { name: "x" }))).toBe("404:user_not_found");
    expect(w.repo.auditLog).toEqual([]);
  });

  it("role changes, disabling (which signs the user out everywhere) and enabling are separate audited actions", async () => {
    const w = world();
    await updateUser(w.deps, ROOT, "u1", { role: "superadmin" });
    await updateUser(w.deps, ROOT, "u2", { disabled: true });
    expect(w.repo.accounts.get("u2")!.sessions).toBe(0);
    await updateUser(w.deps, ROOT, "u2", { disabled: false });
    expect(w.repo.auditLog.map((a) => a.action).reverse()).toEqual(["user.role", "user.disable", "user.enable"]);
  });

  it("a role change and a disable made in one save are both on record", async () => {
    const w = world();
    w.repo.add({ id: "root2", email: "root2@example.test", role: "superadmin" });
    await updateUser(w.deps, ROOT, "root2", { name: "Second", role: "user", disabled: true });
    expect(w.repo.auditLog.map((a) => a.action).sort()).toEqual(["user.disable", "user.role", "user.update"]);
  });

  it("nobody can demote, disable or delete themself", async () => {
    const w = world();
    w.repo.add({ id: "root2", email: "root2@example.test", role: "superadmin" });
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { status: number; code: string }) => `${e.status}:${e.code}`);
    expect(await code(updateUser(w.deps, ROOT, "root", { role: "user" }))).toBe("409:cannot_change_self");
    expect(await code(updateUser(w.deps, ROOT, "root", { disabled: true }))).toBe("409:cannot_change_self");
    expect(await code(deleteUser(w.deps, ROOT, "root", "root@example.test"))).toBe("409:cannot_change_self");
    expect(await code(updateUser(w.deps, ROOT, "root", { name: "Renamed" }))).toBe("ok"); // a harmless edit of oneself is fine
    expect(w.repo.accounts.get("root")!.role).toBe("superadmin");
  });

  it("the last enabled super admin cannot be demoted, disabled or deleted by another; with two, one can", async () => {
    const w = world();
    const other = { id: "u1", email: "ann@example.test" };
    w.repo.accounts.get("u1")!.role = "superadmin";
    w.repo.accounts.get("root")!.disabled = true; // root is out: u1 is the only ENABLED super admin
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { status: number; code: string }) => `${e.status}:${e.code}`);
    const actor = { id: "u2", email: "bob@example.test" };
    expect(await code(updateUser(w.deps, actor, other.id, { role: "user" }))).toBe("409:last_super_admin");
    expect(await code(updateUser(w.deps, actor, other.id, { disabled: true }))).toBe("409:last_super_admin");
    expect(await code(deleteUser(w.deps, actor, other.id, other.email))).toBe("409:last_super_admin");
    w.repo.accounts.get("root")!.disabled = false;
    expect(await code(updateUser(w.deps, ROOT, other.id, { role: "user" }))).toBe("ok");
  });

  it("deleting a user needs their email typed exactly, removes their rows and files, and is audited (the log outlives the account)", async () => {
    const w = world();
    await w.put("u2", "expense", "e", { amount: 5 }, "2026-11-01");
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { status: number; code: string }) => `${e.status}:${e.code}`);
    for (const bad of [undefined, "", "bob", "other@example.test", 5]) expect(await code(deleteUser(w.deps, ROOT, "u2", bad)), String(bad)).toBe("400:confirmation_mismatch");
    expect(w.repo.deleted).toEqual([]);
    const out = await deleteUser(w.deps, ROOT, "u2", " BOB@example.test ");
    expect(out).toEqual({ deleted: true, cleanup: "done" });
    expect(w.removed).toEqual(["hisaab-test/u/u2"]);
    expect([...w.sync.state.rows.keys()].some((k) => k.startsWith("u2\u0000"))).toBe(false);
    expect(w.repo.auditLog[0]).toMatchObject({ action: "user.delete", targetId: "u2" });
    expect(JSON.stringify(w.repo.auditLog[0]!.summary)).toContain("bob@example.test");
    expect(await code(deleteUser(w.deps, ROOT, "u2", "bob@example.test"))).toBe("404:user_not_found");
  });

  it("a failed file clean-up still deletes the account and says so in the audit log", async () => {
    const w = world();
    (w.media.deleteByPrefix as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    expect(await deleteUser(w.deps, ROOT, "u1", "ann@example.test")).toEqual({ deleted: true, cleanup: "failed" });
    expect(w.repo.auditLog[0]!.summary).toMatchObject({ files: "failed", prefix: "hisaab-test/u/u1" });
  });

  it("the reset email is refused while email is not set up, and audited when it is sent", async () => {
    const w = world();
    await expect(sendResetEmail(w.deps, ROOT, "u1")).rejects.toMatchObject({ status: 503, code: "email_not_set_up" });
    const sent: string[] = [];
    const deps = { ...w.deps, sendReset: async (e: string) => void sent.push(e) };
    expect(await sendResetEmail(deps, ROOT, "u1")).toEqual({ sent: true });
    expect(sent).toEqual(["ann@example.test"]);
    expect(w.repo.auditLog[0]).toMatchObject({ action: "user.reset_email", targetId: "u1" });
    await expect(sendResetEmail(deps, ROOT, "ghost")).rejects.toMatchObject({ status: 404 });
  });

  it("the audit log pages, newest first", async () => {
    const w = world();
    for (let i = 0; i < 60; i++) await updateUser(w.deps, ROOT, "u1", { name: `Name ${i}` });
    const a = await adminAudit(w.deps, 1);
    expect(a.entries).toHaveLength(50);
    expect(a.total).toBe(60);
    expect(a.pages).toBe(2);
    expect((a.entries[0]!.summary as { after: { name: string } }).after.name).toBe("Name 59");
    expect((await adminAudit(w.deps, 2)).entries).toHaveLength(10);
  });
});
