import { test as plain, expect, type Page } from "@playwright/test";
import { addUser, fakeServer, newDevice, type Device, type FakeServer } from "./accountMocks";
import { seedScript } from "./seed";

// Sync in real browsers. Every "device" is its own browser context (own localStorage and IndexedDB) talking to ONE in-memory account server that runs the REAL
// server rules (server/utils/syncService.ts). The build under test has accounts OFF; the helpers switch them on in the browser. Nothing reaches a real service.
const EMAIL = "reader@example.test";
const PASSWORD = "a-long-password-1";

const GUEST = seedScript({ theme: "light" }); // a device with data from before it had an account
const EMPTY = seedScript({ data: false }); // a new device

const status = (page: Page) => page.getByTestId("sync-status");
const waitSynced = (page: Page) => expect(status(page)).toHaveAttribute("data-status", "synced", { timeout: 20_000 });
const cacheOf = (page: Page, key: string) =>
  page.evaluate((k) => {
    const hint = JSON.parse(localStorage.getItem("hisaab:auth:hint") || "null");
    const raw = hint ? localStorage.getItem(`hisaab:u:${hint.userId}:${k}`) : null;
    return raw ? JSON.parse(raw) : null;
  }, key);
const guestOf = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(`hisaab:${k}`) || "null"), key);
const liveRows = (server: FakeServer, collection: string) => [...server.repo.state.rows.values()].filter((r) => r.collection === collection && !r.deleted).map((r) => r.id).sort();

async function signIn(page: Page, email = EMAIL) {
  await page.goto("/account");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByTestId("auth-submit").click();
}

async function addExpense(page: Page, amount: string, note: string) {
  await page.goto("/expenses");
  await page.getByTestId("add-expense").click();
  await page.locator("#expense-amount").fill(amount);
  await page.locator("#expense-note").fill(note);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("#expense-amount")).toHaveCount(0);
}

/** Device A signs in with the guest data it already had and uploads it: the usual start of every scenario. */
async function deviceWithUpload(browser: Parameters<Parameters<typeof plain>[2]>[0]["browser"], server: FakeServer) {
  const A = await newDevice(browser, server, { initScript: GUEST });
  await signIn(A.page);
  await A.page.getByTestId("choice-upload").click();
  await waitSynced(A.page);
  return A;
}

const closeAll = async (...devices: Device[]) => {
  for (const d of devices) await d.context.close();
};

plain.describe("the first sign-in", () => {
  plain("a device with data is offered the choice; uploading copies it, leaves the guest data untouched and starts account mode", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await newDevice(browser, server, { initScript: GUEST });
    await signIn(A.page);
    const dialog = A.page.getByTestId("first-sign-in");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This device has");
    await expect(dialog).toContainText("your account has 0");
    expect(server.syncCalls.filter((c) => c.includes("push"))).toEqual([]); // nothing is sent before the person chooses
    const guestBefore = await guestOf(A.page, "expenses");
    expect(guestBefore).toHaveLength(3);
    await A.page.getByTestId("choice-upload").click();
    await waitSynced(A.page);
    expect(liveRows(server, "expense")).toEqual(["e1", "e2", "e3"]);
    expect(liveRows(server, "fundContribution")).toEqual(["c1"]);
    expect(await guestOf(A.page, "expenses")).toEqual(guestBefore); // the guest copy is exactly as it was
    expect((await cacheOf(A.page, "expenses")).map((e: { id: string }) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    const keys = await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hisaab:u:")));
    expect(keys.some((k) => k.endsWith(":sync:ready"))).toBe(true);
    await A.page.goto("/settings");
    await expect(A.page.getByTestId("sync-headline")).toContainText("Everything on this device is in your account");
    await expect(A.page.getByTestId("sync-undo")).toContainText("records were uploaded");
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });

  plain("a second device with nothing on it simply starts with the account's data", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await newDevice(browser, server, { initScript: EMPTY });
    await signIn(B.page);
    await waitSynced(B.page); // no choice dialog: there was nothing on this device to decide about
    await expect(B.page.getByTestId("first-sign-in")).toHaveCount(0);
    expect((await cacheOf(B.page, "expenses")).map((e: { id: string }) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    await B.page.goto("/expenses");
    await expect(B.page.getByText("Groceries", { exact: true })).toBeVisible();
    expect(B.problems).toEqual([]);
    await closeAll(A, B);
  });

  plain("'Not now' leaves the device as it was, and the Account page offers to finish later", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await newDevice(browser, server, { initScript: GUEST });
    await signIn(A.page);
    await A.page.getByTestId("choice-later").click();
    await expect(A.page.getByTestId("first-sign-in")).toHaveCount(0);
    await expect(A.page.getByTestId("needs-setup")).toBeVisible();
    expect(server.syncCalls.filter((c) => c.includes("push") || c.includes("pull"))).toEqual([]);
    await A.page.reload();
    await expect(A.page.getByTestId("sync-status")).toHaveCount(0); // still guest mode
    await A.page.getByTestId("finish-setup").click();
    await expect(A.page.getByTestId("first-sign-in")).toBeVisible();
    await closeAll(A);
  });

  plain("signed out (or accounts on but nobody signed in), nothing calls the sync routes and the page shows no sync", async ({ browser }) => {
    const server = fakeServer();
    const A = await newDevice(browser, server, { initScript: GUEST });
    await A.page.goto("/settings");
    await expect(A.page.getByTestId("account-card")).toBeVisible();
    await expect(A.page.getByTestId("sync-card")).toHaveCount(0);
    await expect(A.page.getByTestId("sync-status")).toHaveCount(0);
    await A.page.goto("/expenses");
    await expect(A.page.getByText("Groceries", { exact: true })).toBeVisible();
    expect(server.syncCalls).toEqual([]);
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });
});

plain.describe("two devices", () => {
  plain("an expense added on one device appears on the other without a reload", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await newDevice(browser, server, { initScript: EMPTY });
    await signIn(B.page);
    await waitSynced(B.page);
    await B.page.goto("/expenses");
    await expect(B.page.getByText("Groceries", { exact: true })).toBeVisible();
    await addExpense(A.page, "250", "Coffee with Sara");
    await waitSynced(A.page);
    await expect(B.page.getByText("Coffee with Sara", { exact: true })).toHaveCount(0);
    await B.page.evaluate(() => window.dispatchEvent(new Event("online"))); // the page learns of the change when it syncs: on focus, on reconnecting, every minute
    await expect(B.page.getByText("Coffee with Sara", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(A.problems).toEqual([]);
    expect(B.problems).toEqual([]);
    await closeAll(A, B);
  });

  plain("offline: the change is kept (and counted), survives a reload, and goes up when the network is back", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await newDevice(browser, server, { initScript: EMPTY, allow: [/Failed to load resource/] });
    await signIn(B.page);
    await waitSynced(B.page);
    A.net.offline = true;
    await addExpense(A.page, "99", "Offline lunch");
    await expect(status(A.page)).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
    await expect(status(A.page)).toContainText("waiting"); // the expense, and the settings it updates (the last category used)
    await A.page.reload();
    await A.page.goto("/expenses");
    await expect(A.page.getByText("Offline lunch", { exact: true })).toBeVisible(); // still here after a reload, offline
    await expect(status(A.page)).toContainText("waiting");
    expect(liveRows(server, "expense")).toHaveLength(3);
    A.net.offline = false;
    await A.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitSynced(A.page);
    expect(liveRows(server, "expense")).toHaveLength(4);
    await B.page.goto("/expenses");
    await B.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(B.page.getByText("Offline lunch", { exact: true })).toBeVisible({ timeout: 15_000 });
    await closeAll(A, B);
  });
});

plain.describe("leaving", () => {
  plain("signing out removes the account's copy from this device and brings the guest data back", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    await addExpense(A.page, "250", "Coffee with Sara");
    await waitSynced(A.page);
    const guestBefore = await guestOf(A.page, "expenses");
    await A.page.goto("/account");
    await Promise.all([A.page.waitForEvent("load"), A.page.getByTestId("sign-out").click()]); // signing out reloads the page into guest mode
    await expect(A.page.getByTestId("auth-form")).toBeVisible({ timeout: 15_000 });
    const left = await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hisaab:u:") || k === "hisaab:auth:hint"));
    expect(left).toEqual([]);
    expect(await guestOf(A.page, "expenses")).toEqual(guestBefore);
    await expect(A.page.getByTestId("sync-status")).toHaveCount(0);
    await A.page.goto("/expenses");
    await expect(A.page.getByText("Groceries", { exact: true })).toBeVisible();
    await expect(A.page.getByText("Coffee with Sara", { exact: true })).toHaveCount(0); // that was the account's, and it is safe there
    expect(liveRows(server, "expense")).toHaveLength(4);
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });
});
