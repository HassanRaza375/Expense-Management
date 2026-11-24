import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { test as plain, type Page } from "@playwright/test";
import { addUser, fakeServer, newDevice } from "./accountMocks";
import { PAGES, seedScript, type Theme } from "./seed";
import { EMAIL, PASSWORD, closeAll, signIn, waitSynced } from "./syncHelpers";

// Accessibility (axe-core, WCAG 2.0/2.1 A and AA rules, including colour contrast) on every route: the 21 pages in both themes, and the account and admin pages.
// A violation fails the test with its rule, the elements and the fix, so nothing is waived here: a rule is only ever switched off with a reason written next to it.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISABLED_RULES: string[] = []; // none

async function scan(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).disableRules(DISABLED_RULES).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ") + "  <- " + n.html.slice(0, 160)).join("\n    ")}`).join("\n  ");
  expect(violations, `${label}\n  ${report}`).toEqual([]);
}

for (const theme of ["light", "dark"] as Theme[]) {
  test.describe(`axe, ${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript(seedScript({ theme }));
    });
    for (const [path, title] of PAGES) {
      test(`${path} (${title})`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("header .font-display")).toHaveText(title);
        await expect(page.locator("main")).not.toBeEmpty();
        await scan(page, `${path} in the ${theme} theme`);
      });
    }
  });
}

test.describe("axe, a phone", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(seedScript({ theme: "light" }));
  });
  for (const [path] of PAGES) {
    test(`${path} at 375px`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).not.toBeEmpty();
      await scan(page, `${path} at 375px`);
    });
  }
});

plain.describe("axe, the account and admin pages", () => {
  for (const theme of ["light", "dark"] as Theme[]) {
    plain(`account (signed out, then signed in) and settings, ${theme}`, async ({ browser }) => {
      const server = fakeServer();
      addUser(server, EMAIL);
      const A = await newDevice(browser, server, { initScript: seedScript({ theme, data: false }) });
      await A.page.goto("/account");
      await expect(A.page.getByTestId("auth-submit")).toBeVisible();
      await scan(A.page, `/account signed out, ${theme}`);
      await signIn(A.page);
      await waitSynced(A.page);
      await scan(A.page, `/account signed in, ${theme}`);
      await A.page.goto("/settings");
      await expect(A.page.getByTestId("account-card")).toBeVisible();
      await scan(A.page, `/settings with an account, ${theme}`);
      expect(A.problems).toEqual([]);
      await closeAll(A);
    });

    plain(`the admin pages, ${theme}`, async ({ browser }) => {
      const server = fakeServer();
      const reader = addUser(server, EMAIL);
      addUser(server, "boss@example.test", PASSWORD, "Boss", "superadmin");
      const A = await newDevice(browser, server, { initScript: seedScript({ theme, data: false }), allow: [/Failed to load resource/] });
      await signIn(A.page, "boss@example.test");
      await waitSynced(A.page);
      for (const path of ["/admin", "/admin/users", `/admin/users/${reader.id}`, "/admin/expenses", "/admin/investments", "/admin/income", "/admin/storage", "/admin/audit"]) {
        await A.page.goto(path);
        await expect(A.page.locator("[data-testid^=admin-]").first()).toBeVisible();
        await expect(A.page.getByText("Loading...")).toHaveCount(0);
        await scan(A.page, `${path}, ${theme}`);
      }
      expect(A.problems).toEqual([]);
      await closeAll(A);
    });
  }
});
