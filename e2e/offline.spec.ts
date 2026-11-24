import { test, expect } from "./fixtures";
import { seedScript } from "./seed";

// Offline proof on the production build: after the first online visit the worker has precached the app, and with the network off every page loads and
// the app still saves data on the device (level A and B pages, docs/NUXT_PLAN.md section 2).
test("with the network off, every page loads and an expense can be added", async ({ page, context, guard }) => {
  guard.allowConsole(/Failed to load resource|net::ERR/i);
  await context.addInitScript(seedScript());
  await page.goto("/dashboard");
  await expect(page.locator("header .font-display")).toHaveText("Dashboard");

  // the worker is active and has precached the whole app
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) return false;
    const keys = await caches.keys();
    if (!keys.length) return false;
    return (await (await caches.open(keys[0]!)).keys()).length > 100;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  for (const [path, needle] of [
    ["/dashboard", "Spent this cycle"],
    ["/expenses", "Net spent"],
    ["/accounts", "Total across your accounts"],
    ["/net-worth", "Net worth"],
    ["/goals", "Goals"],
    ["/bills", "Bills"],
    ["/budget", "Budget"],
    ["/settings", "Backup & restore"],
    ["/investments", "Investments"],
    ["/vault", "Vault"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(needle).first(), path).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
  }

  await page.goto("/");
  await expect(page.locator("header .font-display")).toHaveText("Dashboard");
  await page.goto("/#/expenses");
  await expect(page.locator("header .font-display")).toHaveText("Expenses");

  // work offline: the expense form saves on the device
  await page.getByTestId("add-expense").click();
  await page.locator("#expense-amount").fill("250");
  await page.locator("[role=dialog] button[type=submit]").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:expenses")!).filter((e: { amount: number }) => e.amount === 250).length)).toBe(1);
  await context.setOffline(false);
});
