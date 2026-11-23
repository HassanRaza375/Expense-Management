import { test, expect } from "./fixtures";
import { enableAccountsInBrowser, fakeServer, installFakeAccountServer, makePng } from "./accountMocks";
import { seedScript } from "./seed";

// The optional account, in a real browser, against an in-memory fake of the account server (no real service). The test build is made with the flag OFF; the helpers
// switch it on in the browser. The service worker is blocked so the page's requests can be intercepted.
test.use({ serviceWorkers: "block" });

const EMAIL = "reader@example.test";
const PASSWORD = "a-long-password-1";

/** Every hisaab:* localStorage entry, to prove the account never touches the data on the device. */
const deviceData = (page: import("@playwright/test").Page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("hisaab:") && k !== "hisaab:session-unlocked").sort().map((k) => [k, localStorage.getItem(k)])));

test.describe("accounts turned OFF (the app as it is today)", () => {
  test("no account card, no sidebar entry, /account goes to Settings, and nothing calls the server", async ({ page, context, guard }) => {
    guard.allowConsole(/Service Worker registration blocked by Playwright/);
    await context.addInitScript(seedScript({}));
    const api: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) api.push(r.url());
    });
    await page.goto("/settings");
    await expect(page.locator("header .font-display")).toHaveText("Settings");
    await expect(page.getByTestId("account-card")).toHaveCount(0);
    await expect(page.locator("aside a[href='/account']")).toHaveCount(0);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/settings$/);
    await page.goto("/dashboard");
    await expect(page.locator("header .font-display")).toHaveText("Dashboard");
    expect(api, "the app called the server while accounts are off").toEqual([]);
  });
});

test.describe("accounts turned ON", () => {
  test.beforeEach(async ({ context, guard }) => {
    await context.addInitScript(seedScript({}));
    guard.allowConsole(/Service Worker registration blocked by Playwright/); // the worker is blocked on purpose (see above)
  });

  async function start(page: import("@playwright/test").Page, over = {}) {
    await enableAccountsInBrowser(page);
    return installFakeAccountServer(page, fakeServer(over));
  }

  test("Settings offers the account; the sidebar has an Account entry", async ({ page }) => {
    await start(page);
    await page.goto("/settings");
    await expect(page.getByTestId("account-card")).toContainText("An account is optional");
    await expect(page.locator("aside a[href='/account']")).toHaveCount(1);
    await page.getByTestId("account-card").getByRole("button", { name: "Sign in or create account" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator("header .font-display")).toHaveText("Account");
  });

  test("creating an account signs you in; the form checks the password length and says what is not available yet", async ({ page }) => {
    const s = await start(page);
    await page.goto("/account");
    await page.getByTestId("mode-sign-up").click();
    await expect(page.getByTestId("google-off")).toBeVisible();
    await expect(page.getByTestId("google-button")).toBeDisabled();
    await expect(page.getByTestId("email-off")).toContainText("cannot be reset by email");
    await page.getByLabel("Name").fill("Reader");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("short");
    await expect(page.getByTestId("auth-submit")).toBeDisabled();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("account-email")).toHaveText(EMAIL);
    expect(s.session).toBe(EMAIL);
    // the password was sent once, to the sign-up route, and nowhere else
    expect(s.requests.filter((r) => r.body.includes(PASSWORD)).map((r) => r.path)).toEqual(["/api/auth/sign-up/email"]);
  });

  test("with email set up the account waits for confirmation", async ({ page }) => {
    await start(page, { features: { google: false, email: true, passwordMin: 10 }, signUpNeedsVerification: true });
    await page.goto("/account");
    await page.getByTestId("mode-sign-up").click();
    await expect(page.getByTestId("email-off")).toHaveCount(0);
    await page.getByLabel("Name").fill("Reader");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-message")).toContainText("confirm it");
    await expect(page.getByTestId("account-email")).toHaveCount(0);
  });

  test("sign in: a wrong password says so plainly, the right one signs in, sign out returns to the form", async ({ page, guard }) => {
    guard.allowConsole(/Failed to load resource/); // expected: this test makes the server refuse (401) and Chrome logs every non-2xx response
    const s = await start(page);
    s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: false, role: "user" });
    await page.goto("/account");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-message")).toHaveText("That email and password do not match.");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("account-email")).toHaveText(EMAIL);
    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("auth-form")).toBeVisible();
    expect(s.session).toBeNull();
  });

  test("too many attempts: a plain message, not a code", async ({ page, guard }) => {
    guard.allowConsole(/Failed to load resource/); // expected: this test makes the server refuse (429) and Chrome logs every non-2xx response
    const s = await start(page, { rateLimitSignIn: true });
    await page.goto("/account");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-message")).toHaveText("Too many attempts. Wait a minute and try again.");
    expect(s.session).toBeNull();
  });

  test("the profile photo: choose, crop, save (a small JPEG square is sent), then remove (the generated picture returns)", async ({ page }) => {
    const s = await start(page);
    s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: false, role: "user" });
    s.session = EMAIL;
    await page.goto("/account");
    const avatar = page.getByTestId("user-avatar").first();
    await expect(avatar).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await page.getByTestId("photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: makePng(1200, 800) });
    await expect(page.getByTestId("crop-view")).toBeVisible();
    await page.getByLabel("Zoom").fill("2");
    await page.getByTestId("crop-view").focus();
    await page.keyboard.press("ArrowLeft");
    await page.getByTestId("crop-save").click();
    await expect(page.getByTestId("crop-view")).toHaveCount(0);
    await expect(avatar).toHaveAttribute("src", /pwa-192x192\.png$/);
    expect(s.lastPhoto!.isJpeg).toBe(true);
    expect(s.lastPhoto!.type).toBe("image/jpeg");
    expect(s.lastPhoto!.size).toBeLessThanOrEqual(400 * 1024);
    expect(s.lastPhoto!.size).toBeGreaterThan(1000);
    await page.getByTestId("photo-remove").click();
    await expect(avatar).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect(page.getByTestId("photo-remove")).toHaveCount(0);
  });

  test("a file that is not a picture is refused in the browser, before anything is sent", async ({ page }) => {
    const s = await start(page);
    s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: false, role: "user" });
    s.session = EMAIL;
    await page.goto("/account");
    await page.getByTestId("photo-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("account-message")).toHaveText("Choose a JPEG, PNG or WebP picture.");
    expect(s.requests.some((r) => r.path === "/api/account/avatar")).toBe(false);
  });

  test("change name and password", async ({ page, guard }) => {
    guard.allowConsole(/Failed to load resource/); // expected: this test makes the server refuse (a refused password change (400)) and Chrome logs every non-2xx response
    const s = await start(page);
    s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: false, role: "user" });
    s.session = EMAIL;
    await page.goto("/account");
    await page.getByLabel("Name", { exact: true }).fill("Reader Two");
    await page.getByTestId("name-save").click();
    await expect.poll(() => s.users.get(EMAIL)!.name).toBe("Reader Two");
    await page.getByLabel("Current password").fill("wrong-wrong-wrong");
    await page.getByLabel("New password").fill("another-long-password");
    await page.getByTestId("password-save").click();
    await expect(page.getByTestId("account-message")).toHaveText("That password is not correct.");
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByTestId("password-save").click();
    await expect.poll(() => s.users.get(EMAIL)!.password).toBe("another-long-password");
  });

  test("delete account needs the typed email; afterwards you are signed out and the device's data is untouched", async ({ page }) => {
    const s = await start(page);
    s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: true, role: "user" });
    s.session = EMAIL;
    await page.goto("/account");
    await expect(page.getByTestId("account-email")).toHaveText(EMAIL);
    const before = await deviceData(page);
    expect(Object.keys(before).length).toBeGreaterThan(5);
    await expect(page.getByTestId("delete-account")).toBeDisabled();
    await page.getByTestId("delete-confirm").fill("someone-else@example.test");
    await expect(page.getByTestId("delete-account")).toBeDisabled();
    await page.getByTestId("delete-confirm").fill(EMAIL.toUpperCase());
    await expect(page.getByTestId("delete-account")).toBeEnabled();
    await page.getByTestId("delete-account").click();
    await expect(page.getByTestId("auth-form")).toBeVisible();
    expect(s.users.has(EMAIL)).toBe(false);
    expect(await deviceData(page)).toEqual(before);
  });

  test("signing in and out never changes the data on this device", async ({ page }) => {
    const s = await start(page);
    s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: false, role: "user" });
    await page.goto("/settings");
    await expect(page.getByTestId("account-card")).toBeVisible();
    const before = await deviceData(page);
    await page.goto("/account");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("account-email")).toBeVisible();
    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("auth-form")).toBeVisible();
    expect(await deviceData(page)).toEqual(before);
  });

  test("offline or an unavailable service: a clear message, the app keeps working, Try again recovers", async ({ page, guard }) => {
    guard.allowConsole(/Failed to load resource/); // expected: this test makes the server refuse (a failed or 503 request) and Chrome logs every non-2xx response
    const s = await start(page, { offline: true });
    await page.goto("/account");
    await expect(page.getByTestId("account-unreachable")).toContainText("offline");
    await page.goto("/settings");
    await expect(page.getByTestId("account-card")).toContainText("offline");
    await page.goto("/expenses");
    await expect(page.locator("header .font-display")).toHaveText("Expenses");
    s.offline = false;
    s.down = 503;
    await page.goto("/account");
    await expect(page.getByTestId("account-unreachable")).toContainText("not available right now");
    s.down = null;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("auth-form")).toBeVisible();
  });

  for (const theme of ["dark", "light"] as const) {
    for (const [name, width] of [["1280px", 1280], ["375px", 375]] as const) {
      test(`the Account page fits the screen (${theme}, ${name}), signed out and signed in`, async ({ page, context }) => {
        // the default seed (beforeEach) has already run and marked the browser seeded, so set the saved theme directly
        await context.addInitScript(`try { const k = 'hisaab:settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.theme = '${theme}'; localStorage.setItem(k, JSON.stringify(s)); } catch (e) {}`);
        const s = await start(page);
        s.users.set(EMAIL, { id: "u1", name: "Reader", email: EMAIL, password: PASSWORD, hasPhoto: false, role: "user" });
        await page.setViewportSize({ width, height: 800 });
        const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
        await page.goto("/account");
        await expect(page.getByTestId("auth-form")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await noSideScroll(), "signed out: horizontal scroll").toBe(true);
        s.session = EMAIL;
        await page.goto("/account");
        await expect(page.getByTestId("account-email")).toBeVisible();
        expect(await noSideScroll(), "signed in: horizontal scroll").toBe(true);
      });
    }
  }
});

