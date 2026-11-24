import { test, expect } from "./fixtures";
import { addUser, enableAccountsInBrowser, fakeServer, installFakeAccountServer } from "./accountMocks";
import { seedScript } from "./seed";

// The load-order guarantee (docs/DECISIONS.md D7, CLAUDE.md "Module-load order is load-bearing"): composables read storage the moment they are imported, so the data check
// (migration, snapshot, and the switch to account mode) must be finished first. This records what the page does, in order, instead of assuming it.
// The log is installed AFTER the test data is seeded, so it only sees the app.
const LOG = `(() => {
  const w = window; w.__io = [];
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
  Storage.prototype.getItem = function (k) {
    if (/^hisaab:(u:[^:]+:)?expenses$/.test(k) || k === 'hisaab:auth:hint') w.__io.push('get ' + k.replace(/^hisaab:u:[^:]+:/, 'hisaab:u:USER:'));
    return get.call(this, k);
  };
  Storage.prototype.setItem = function (k, v) {
    if (k === 'hisaab:meta') w.__io.push('set meta ' + v);
    return set.call(this, k, v);
  };
})();`;

const io = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __io: string[] }).__io);

test.use({ serviceWorkers: "block" });

test("guest mode: the data version is stamped (the migration has run) before any composable reads the expenses", async ({ page, context, guard }) => {
  guard.allowConsole(/Service Worker registration blocked by Playwright/);
  await context.addInitScript(seedScript({ meta: { version: 2 } })); // data from before the goals/withdrawals update: needs a migration
  await context.addInitScript(LOG);
  await page.goto("/expenses");
  await expect(page.locator("header .font-display")).toHaveText("Expenses");
  const log = await io(page);
  const stamped = log.findIndex((l) => l.startsWith("set meta") && l.includes('"version":3'));
  expect(stamped, `the version stamp was never written: ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
  // Before the stamp the expenses are read exactly once: by the SAFETY SNAPSHOT the migration takes first. A second read would be a composable loading too early.
  expect(log.slice(0, stamped).filter((l) => l === "get hisaab:expenses"), JSON.stringify(log)).toHaveLength(1);
  expect(log.slice(stamped).filter((l) => l === "get hisaab:expenses").length, JSON.stringify(log)).toBeGreaterThanOrEqual(1); // and the composables read after
});

test("account mode: who is signed in is known before any composable reads data, and the guest copy is never read", async ({ page, context, guard }) => {
  guard.allowConsole(/Service Worker registration blocked by Playwright/);
  const server = fakeServer();
  const user = addUser(server, "reader@example.test");
  // a device that finished its first sign-in earlier: a hint, the ready marker, and the account's data in the user's cache; the guest data is something else entirely
  await context.addInitScript(
    seedScript({
      script: `
      localStorage.setItem('hisaab:auth:hint', JSON.stringify({ userId: ${JSON.stringify(user.id)}, email: 'reader@example.test' }));
      localStorage.setItem('hisaab:u:${user.id}:sync:ready', '1');
      localStorage.setItem('hisaab:u:${user.id}:expenses', JSON.stringify([{ id: 'acct1', date: new Date().toISOString(), amount: 321, categoryId: 'cat-food', note: 'only in the account', createdAt: new Date().toISOString() }]));`,
    }),
  );
  await context.addInitScript(LOG);
  await enableAccountsInBrowser(page);
  server.session = "reader@example.test";
  await installFakeAccountServer(page, server);
  await page.goto("/expenses");
  await expect(page.locator("header .font-display")).toHaveText("Expenses");
  const log = await io(page);
  await expect(page.getByText("only in the account", { exact: true }), JSON.stringify(log)).toBeVisible(); // the page shows the ACCOUNT's expenses, not the guest ones
  await expect(page.getByText("Groceries", { exact: true })).toHaveCount(0);
  const hint = log.indexOf("get hisaab:auth:hint");
  const cacheRead = log.indexOf("get hisaab:u:USER:expenses");
  expect(hint, JSON.stringify(log)).toBeGreaterThanOrEqual(0);
  expect(cacheRead, JSON.stringify(log)).toBeGreaterThanOrEqual(0);
  expect(hint).toBeLessThan(cacheRead);
  expect(log.filter((l) => l === "get hisaab:expenses")).toEqual([]); // the guest copy was never read in account mode
});
