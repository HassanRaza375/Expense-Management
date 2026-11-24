import { test, expect } from "./fixtures";
import { seedScript } from "./seed";

// The data check runs BEFORE any page, layout or composable loads (app/lib/startup.ts, docs/DECISIONS.md D7).
const EXPENSE = `localStorage.setItem('hisaab:expenses', JSON.stringify([{ id: 'e1', date: new Date().toISOString(), amount: 10, categoryId: 'cat-food', note: 'x', source: 'manual', createdAt: new Date().toISOString() }]));`;

async function snapshots(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === "hisaab-backups")) return [];
    return new Promise<string[]>((resolve) => {
      const r = indexedDB.open("hisaab-backups");
      r.onsuccess = () => {
        const db = r.result;
        const q = db.transaction("snapshots").objectStore("snapshots").getAll();
        q.onsuccess = () => {
          db.close();
          resolve(q.result.map((s: { reason: string; backup: { data: { expenses?: unknown[] } } }) => `${s.reason}:${s.backup.data.expenses?.length ?? 0}`));
        };
      };
    });
  });
}

test("data from a NEWER version blocks the app, says why, and writes nothing", async ({ page, context }) => {
  await context.addInitScript(seedScript({ data: false, meta: { version: 99 }, script: EXPENSE }));
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toContainText("Hisaab did not start");
  await expect(page.getByRole("alert")).toContainText("newer version of Hisaab");
  await expect(page.locator("aside")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hisaab:meta"))).toBe('{"version":99}');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:expenses") || "[]").length)).toBe(1);
  expect(await snapshots(page)).toEqual([]);
});

test("data from before the goals/withdrawals update (version 2) is migrated, with a snapshot taken FIRST", async ({ page, context }) => {
  await context.addInitScript(seedScript({ data: false, meta: { version: 2 }, script: EXPENSE }));
  await page.goto("/dashboard");
  await expect(page.locator("header .font-display")).toHaveText("Dashboard");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:meta")!).version)).toBe(3);
  expect(await snapshots(page)).toEqual(["before-migration:1"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:expenses")!)[0].amount)).toBe(10);
});

test("data from before versioning existed (no meta) counts as version 1 and is migrated with a snapshot", async ({ page, context }) => {
  await context.addInitScript(seedScript({ data: false, meta: null, script: EXPENSE }));
  await page.goto("/dashboard");
  await expect(page.locator("header .font-display")).toHaveText("Dashboard");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:meta")!).version)).toBe(3);
  expect(await snapshots(page)).toEqual(["before-migration:1"]);
});

test("a fresh install is stamped with the current version and takes no snapshot", async ({ page, context }) => {
  await context.addInitScript(seedScript({ data: false, meta: null }));
  await page.goto("/dashboard");
  await expect(page.locator("header .font-display")).toHaveText("Dashboard");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:meta")!).version)).toBe(3);
  expect(await snapshots(page)).toEqual([]);
});

test("the screen lock still shows when the session is not unlocked", async ({ page, context }) => {
  await context.addInitScript(seedScript({ data: false, meta: null, unlocked: false }));
  await page.goto("/dashboard");
  await expect(page.getByText("Set a password to protect Hisaab")).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
});
