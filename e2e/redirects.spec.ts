import { test, expect } from "./fixtures";
import { seedScript } from "./seed";

test.describe("addresses", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(seedScript());
  });

  test("an old hash address opens the real path (bookmarks and the installed PWA keep working)", async ({ page }) => {
    await page.goto("/#/expenses");
    await expect(page.locator("header .font-display")).toHaveText("Expenses");
    expect(new URL(page.url()).pathname).toBe("/expenses");
    expect(new URL(page.url()).hash).toBe("");
  });

  test("an old hash address keeps its parameters", async ({ page }) => {
    await page.goto("/#/expenses?cycle=all&account=none");
    await expect(page.locator("header .font-display")).toHaveText("Expenses");
    const u = new URL(page.url());
    expect(u.pathname).toBe("/expenses");
    expect(u.searchParams.get("account")).toBe("none");
  });

  test("an old deep hash address works", async ({ page }) => {
    await page.goto("/#/accounts/acc1");
    await expect(page.locator("header .font-display")).toHaveText("Account");
    expect(new URL(page.url()).pathname).toBe("/accounts/acc1");
  });

  test("the root goes to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header .font-display")).toHaveText("Dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });

  test("an unknown path goes to the dashboard", async ({ page }) => {
    await page.goto("/nope/nothing");
    await expect(page.locator("header .font-display")).toHaveText("Dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });

  test("the blocked-start screen is not reachable when the data is fine", async ({ page }) => {
    await page.goto("/startup-blocked");
    await expect(page.locator("header .font-display")).toHaveText("Dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });
});
