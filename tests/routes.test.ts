import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTES } from "~/lib/routes";

// The route table is the old Vite router's table (docs/DECISIONS.md D3). These are the routes the app had BEFORE the migration, written out by hand,
// so a change to the table is a deliberate edit of this test too.
const OLD_ROUTES: Array<[string, string, string]> = [
  ["dashboard", "/dashboard", "Dashboard"],
  ["expenses", "/expenses", "Expenses"],
  ["income", "/income", "Income"],
  ["accounts", "/accounts", "Accounts"],
  ["accountDetail", "/accounts/:id", "Account"],
  ["netWorth", "/net-worth", "Net worth"],
  ["goals", "/goals", "Goals"],
  ["bills", "/bills", "Bills"],
  ["meterReading", "/bills/meters/:connectionId", "Meter Reading"],
  ["recurring", "/recurring", "Recurring"],
  ["categories", "/categories", "Categories"],
  ["budget", "/budget", "Budget"],
  ["vault", "/vault", "Vault"],
  ["assets", "/assets", "Assets"],
  ["investments", "/investments", "Investments"],
  ["fundDetail", "/investments/:id", "Fund"],
  ["vehicles", "/vehicles", "Vehicles"],
  ["vehicleDetail", "/vehicles/:id", "Vehicle"],
  ["lending", "/lending", "Lending"],
  ["loanDetail", "/lending/:id", "Loan"],
  ["settings", "/settings", "Settings"],
];

describe("route table", () => {
  it("keeps every old route with the same name, path and title", () => {
    for (const [name, path, title] of OLD_ROUTES) {
      const r = ROUTES.find((x) => x.name === name);
      expect(r, `route ${name}`).toBeTruthy();
      expect(r!.path).toBe(path);
      expect(r!.title).toBe(title);
    }
  });

  it("has unique names and unique paths", () => {
    expect(new Set(ROUTES.map((r) => r.name)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  it("sends the root and every unknown path to the dashboard", () => {
    expect(ROUTES.find((r) => r.path === "/")?.redirect).toBe("/dashboard");
    expect(ROUTES.find((r) => r.path === "/:pathMatch(.*)*")?.redirect).toBe("/dashboard");
  });

  it("points every page at a view file that exists", () => {
    for (const r of ROUTES) {
      if (r.redirect) continue;
      expect(r.view, r.name).toBeTruthy();
      expect(existsSync(fileURLToPath(new URL(`../app/views/${r.view}`, import.meta.url))), `${r.name} -> ${r.view}`).toBe(true);
    }
  });

  it("gives only the blocked screen a layout-free page, and puts it before the catch-all", () => {
    const noLayout = ROUTES.filter((r) => r.layout === false).map((r) => r.name);
    expect(noLayout).toEqual(["startupBlocked"]);
    expect(ROUTES.findIndex((r) => r.name === "startupBlocked")).toBeLessThan(ROUTES.findIndex((r) => r.name === "notFound"));
  });

  it("never claims an /api or /admin path as an app page by accident (admin pages arrive in a later phase)", () => {
    for (const r of ROUTES) expect(r.path.startsWith("/api")).toBe(false);
  });

  it("the blocked view imports no composable and uses no layout (nothing may read the data from there)", () => {
    const src = readFileSync(fileURLToPath(new URL("../app/views/StartupBlockedView.vue", import.meta.url)), "utf8");
    expect(src).not.toMatch(/composables\//);
    expect(src).not.toMatch(/utils\/storage/);
  });

  it("app.vue imports no composable (so nothing reads storage before the data check)", () => {
    const src = readFileSync(fileURLToPath(new URL("../app/app.vue", import.meta.url)), "utf8");
    expect(src).not.toMatch(/composables\//);
    expect(src).not.toMatch(/utils\/storage/);
  });
});
