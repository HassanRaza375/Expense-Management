import { test as plain, expect, type Page } from "@playwright/test";
import { addUser, fakeServer, newDevice } from "./accountMocks";
import { seedScript } from "./seed";
import { EMAIL, EMPTY, PASSWORD, cacheOf, closeAll, deviceWithUpload, signIn, waitSynced } from "./syncHelpers";

// The super-admin panel in real browsers. The server rules are the REAL ones (server/utils/adminService.ts) over an in-memory repository that mirrors the fake account server;
// nothing reaches a real service. A person who is not a signed-in super admin is told nothing: the pages send them to the dashboard and the API answers 404.
const ADMIN = "boss@example.test";
const BLOCKED = [/Failed to load resource/]; // the expected 404s of the admin routes are logged by Chrome

const api = (page: Page, path: string, init?: RequestInit) =>
  page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p as string, i as RequestInit);
      return { status: r.status, body: await r.text() };
    },
    [path, init ?? {}] as const,
  );

const adminDevice = async (browser: Parameters<typeof newDevice>[0], server: ReturnType<typeof fakeServer>, opts: { viewport?: { width: number; height: number }; initScript?: string } = {}) => {
  const A = await newDevice(browser, server, { initScript: opts.initScript ?? EMPTY, allow: BLOCKED, viewport: opts.viewport });
  await signIn(A.page, ADMIN);
  await waitSynced(A.page);
  return A;
};

plain.describe("who can see the admin area", () => {
  plain("a signed-out visitor and an ordinary user get the dashboard and a 404, and no Admin entry", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    const A = await newDevice(browser, server, { initScript: EMPTY, allow: BLOCKED });
    // signed out
    await A.page.goto("/admin/users");
    await expect(A.page).toHaveURL(/\/dashboard$/);
    expect((await api(A.page, "/api/admin/overview")).status).toBe(404);
    // an ordinary user
    await signIn(A.page, EMAIL);
    await waitSynced(A.page);
    await A.page.goto("/admin");
    await expect(A.page).toHaveURL(/\/dashboard$/);
    await expect(A.page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    for (const path of ["/api/admin/overview", "/api/admin/users", "/api/admin/audit", "/api/admin/storage"]) {
      const r = await api(A.page, path);
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ error: "not_found" }); // the same answer as an address that does not exist
    }
    expect((await api(A.page, "/api/admin/users/anyone", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "x" }) })).status).toBe(404);
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });

  plain("a super admin sees the Admin entry and the pages", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    const A = await adminDevice(browser, server);
    await expect(A.page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();
    await A.page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(A.page.getByTestId("admin-overview")).toBeVisible();
    await expect(A.page.getByTestId("stat-Users")).toHaveText("2");
    await expect(A.page.getByTestId("stat-Super admins")).toHaveText("1");
    for (const [label, id] of [["Users", "admin-users"], ["Expenses", "admin-expenses"], ["Investments", "admin-investments"], ["Income & cash flow", "admin-income"], ["Receipts & storage", "admin-storage"], ["Audit log", "admin-audit"]] as const) {
      await A.page.getByTestId("admin-nav").getByRole("link", { name: label }).click();
      await expect(A.page.getByTestId(id)).toBeVisible();
    }
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });
});

plain.describe("what the admin sees", () => {
  plain("an account's totals equal the numbers in that account's own app, and no note or private content is shown", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    const U = await deviceWithUpload(browser, server); // the reader's device: e1 900, e2 120, e3 300 (a total of 1,320.00) and the other seeded data
    const own = ((await cacheOf(U.page, "expenses")) as Array<{ amount: number }>).reduce((n, e) => n + e.amount, 0);
    expect(own).toBe(1320);
    const userId = await U.page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:auth:hint")!).userId);
    const A = await adminDevice(browser, server);
    await A.page.goto(`/admin/users/${userId}`);
    await expect(A.page.getByTestId("user-expense-total")).toHaveText("1,320.00");
    await A.page.goto(`/admin/expenses?userId=${userId}`);
    await expect(A.page.getByTestId("admin-expenses")).toContainText("1,320.00");
    await A.page.goto(`/admin/income?userId=${userId}`);
    await expect(A.page.getByTestId("admin-income")).toContainText("5,000.00"); // the seeded salary
    // nothing private: no notes or names of the person's own records, on any admin page or in any admin response (an income KIND such as `salary` is a category, and is shown)
    for (const path of [`/admin/users/${userId}`, `/admin/expenses?userId=${userId}`, "/admin/income", "/admin/investments", "/admin/storage", "/admin"]) {
      await A.page.goto(path);
      await expect(A.page.locator("main, body").first()).not.toContainText(/Groceries|Lunch|Index fund|Meezan/);
    }
    for (const p of ["/api/admin/expenses", "/api/admin/income", "/api/admin/investments", `/api/admin/users/${userId}`]) {
      const r = await api(A.page, p);
      expect(r.status).toBe(200);
      expect(r.body).not.toMatch(/Groceries|Lunch|Holiday|Index fund|Meezan|Home power/); // notes and names
      expect(r.body).not.toMatch(/passphrase|password/i);
    }
    expect(A.problems).toEqual([]);
    expect(U.problems).toEqual([]);
    await closeAll(A, U);
  });

  plain("the users list can be searched and filtered", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    for (let i = 1; i <= 27; i++) addUser(server, `person${String(i).padStart(2, "0")}@example.test`, PASSWORD, `Person ${i}`);
    const A = await adminDevice(browser, server);
    await A.page.goto("/admin/users");
    await expect(A.page.getByTestId("user-row")).toHaveCount(25); // 25 to a page
    await expect(A.page.getByTestId("user-pager")).toContainText("Page 1 of 2 (28 users)");
    await A.page.getByRole("button", { name: "Next" }).click();
    await expect(A.page.getByTestId("user-row")).toHaveCount(3);
    await A.page.getByTestId("user-search").fill("person07");
    await expect(A.page.getByTestId("user-row")).toHaveCount(1);
    await expect(A.page.getByTestId("user-row")).toContainText("person07@example.test");
    await A.page.getByTestId("user-search").fill("");
    await A.page.getByTestId("user-role").selectOption("superadmin");
    await expect(A.page.getByTestId("user-row")).toHaveCount(1);
    await expect(A.page.getByTestId("user-row")).toContainText(ADMIN);
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });
});

plain.describe("what the admin can change", () => {
  plain("edit, promote, disable, then delete with the typed email: every change is in the audit log", async ({ browser }) => {
    const server = fakeServer();
    const reader = addUser(server, EMAIL);
    addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    const A = await adminDevice(browser, server);
    await A.page.goto(`/admin/users/${reader.id}`);
    // a save is finished when it is in the audit log and the page has reloaded the user (the form is rebuilt from it, so wait before the next edit)
    const save = async () => {
      const before = server.admin!.auditLog.length;
      await A.page.getByTestId("user-save").click();
      await expect.poll(() => server.admin!.auditLog.length).toBeGreaterThan(before);
      await expect(A.page.getByTestId("user-save")).toBeEnabled();
    };
    await A.page.getByTestId("edit-name").fill("Renamed Reader");
    await save();
    await expect.poll(() => server.admin!.accounts.get(reader.id)!.name).toBe("Renamed Reader");
    await A.page.getByTestId("edit-role").selectOption("superadmin");
    await save();
    await expect.poll(() => server.admin!.accounts.get(reader.id)!.role).toBe("superadmin");
    await A.page.getByTestId("edit-role").selectOption("user");
    await A.page.getByTestId("edit-disabled").check();
    await save();
    await expect.poll(() => server.admin!.accounts.get(reader.id)!.disabled).toBe(true);
    // the reset email is refused honestly while email is not set up
    await A.page.getByTestId("user-reset").click();
    await expect(A.page.getByTestId("admin-message")).toContainText("Email is not set up");
    // delete needs the typed email
    await expect(A.page.getByTestId("user-delete")).toBeDisabled();
    await A.page.getByTestId("user-delete-confirm").fill("wrong@example.test");
    await expect(A.page.getByTestId("user-delete")).toBeDisabled();
    await A.page.getByTestId("user-delete-confirm").fill(EMAIL);
    await A.page.getByTestId("user-delete").click();
    await expect(A.page).toHaveURL(/\/admin\/users$/);
    await expect(A.page.getByTestId("user-row")).toHaveCount(1);
    expect(server.admin!.deleted).toEqual([reader.id]);
    await A.page.goto("/admin/audit");
    const rows = A.page.getByTestId("audit-row");
    await expect(rows).toHaveCount(5);
    for (const action of ["user.update", "user.role", "user.disable", "user.delete"]) await expect(A.page.getByTestId("admin-audit")).toContainText(action);
    await expect(rows.first()).toContainText(ADMIN);
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });

  plain("an admin cannot demote, disable or delete themselves, and the last super admin is protected", async ({ browser }) => {
    const server = fakeServer();
    const boss = addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    const A = await adminDevice(browser, server);
    await A.page.goto(`/admin/users/${boss.id}`);
    await A.page.getByTestId("edit-role").selectOption("user");
    await A.page.getByTestId("user-save").click();
    await expect(A.page.getByTestId("admin-message")).toContainText("cannot demote, disable or delete your own account");
    expect(server.admin!.accounts.get(boss.id)!.role).toBe("superadmin");
    await A.page.getByTestId("user-delete-confirm").fill(ADMIN);
    await A.page.getByTestId("user-delete").click();
    await expect(A.page.getByTestId("admin-message")).toContainText("cannot demote, disable or delete your own account");
    expect(server.admin!.deleted).toEqual([]);
    await A.page.goto("/admin/audit");
    await expect(A.page.getByTestId("audit-row")).toHaveCount(0); // refused changes are not changes
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });

  plain("the reset email is sent when email is set up", async ({ browser }) => {
    const server = fakeServer();
    server.emailSetUp = true;
    const reader = addUser(server, EMAIL);
    addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
    const A = await adminDevice(browser, server);
    await A.page.goto(`/admin/users/${reader.id}`);
    await A.page.getByTestId("user-reset").click();
    await expect(A.page.getByText("Reset email sent")).toBeVisible();
    await expect(A.page.getByTestId("admin-message")).toHaveCount(0);
    await closeAll(A);
  });
});

plain.describe("the admin pages fit the screen", () => {
  for (const [theme, width] of [["light", 375], ["dark", 375], ["light", 1280], ["dark", 1280]] as const) {
    plain(`no sideways scrolling at ${width}px, ${theme}`, async ({ browser }) => {
      const server = fakeServer();
      const reader = addUser(server, EMAIL);
      addUser(server, ADMIN, PASSWORD, "Boss", "superadmin");
      const A = await adminDevice(browser, server, { viewport: { width, height: 800 }, initScript: seedScript({ theme, data: false }) });
      for (const path of ["/admin", "/admin/users", `/admin/users/${reader.id}`, "/admin/expenses", "/admin/investments", "/admin/income", "/admin/storage", "/admin/audit"]) {
        await A.page.goto(path);
        await expect(A.page.locator("[data-testid^=admin-]").first()).toBeVisible();
        const overflow = await A.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
      await A.page.goto("/settings");
      await expect(A.page.getByTestId("owner-note")).toBeVisible();
      expect(A.problems).toEqual([]);
      await closeAll(A);
    });
  }

  plain("the honest line about what the service owner can see is shown on the Account page", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await newDevice(browser, server, { initScript: EMPTY });
    await A.page.goto("/account");
    await expect(A.page.getByTestId("owner-note")).toContainText("cannot see your notes, receipts, attachments, Vault or password");
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });
});
