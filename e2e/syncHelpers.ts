import { expect, type Browser, type Page } from "@playwright/test";
import { newDevice, type Device, type FakeServer } from "./accountMocks";
import { seedScript } from "./seed";

// Shared by the sync specs. Every "device" is its own browser context (own localStorage and IndexedDB) talking to ONE in-memory account server that runs the REAL server
// rules (server/utils/syncService.ts). The build under test has accounts OFF; the helpers switch them on in the browser. Nothing reaches a real service.
export const EMAIL = "reader@example.test";
export const PASSWORD = "a-long-password-1";

export const GUEST = seedScript({ theme: "light" }); // a device with data from before it had an account
export const EMPTY = seedScript({ data: false }); // a new device

export const status = (page: Page) => page.getByTestId("sync-status");
export const waitSynced = (page: Page) => expect(status(page)).toHaveAttribute("data-status", "synced", { timeout: 20_000 });

/** A value of the signed-in user's cache on this device (what the app is showing in account mode). */
export const cacheOf = (page: Page, key: string) =>
  page.evaluate((k) => {
    const hint = JSON.parse(localStorage.getItem("hisaab:auth:hint") || "null");
    const raw = hint ? localStorage.getItem(`hisaab:u:${hint.userId}:${k}`) : null;
    return raw ? JSON.parse(raw) : null;
  }, key);

/** A value of the guest storage (hisaab:<key>), which account mode never touches. */
export const guestOf = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(`hisaab:${k}`) || "null"), key);

/** The ids of the live (not deleted) records of one collection that the fake account holds. */
export const liveRows = (server: FakeServer, collection: string) =>
  [...server.repo.state.rows.values()]
    .filter((r) => r.collection === collection && !r.deleted)
    .map((r) => r.id)
    .sort();

export async function signIn(page: Page, email = EMAIL) {
  await page.goto("/account");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByTestId("auth-submit").click();
}

/**
 * Types into form fields and checks that every value held. The dialog's own autofocus can land late (a pre-existing behaviour of the app); `fill` focuses a field and then
 * inserts text into whatever is focused, so text meant for one field can go into the number Amount field and be thrown away. A person cannot type that fast; a test can,
 * so it verifies and tries again.
 */
async function fillAndVerify(page: Page, fields: Array<[selector: string, value: string]>) {
  await expect(async () => {
    for (const [sel, v] of fields) await page.locator(sel).fill(v);
    for (const [sel, v] of fields) await expect(page.locator(sel)).toHaveValue(v, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

export async function addExpense(page: Page, amount: string, note: string) {
  await page.goto("/expenses");
  await page.getByTestId("add-expense").click();
  await expect(page.locator("#expense-amount")).toBeFocused();
  await fillAndVerify(page, [["#expense-amount", amount], ["#expense-note", note]]);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("#expense-amount")).toHaveCount(0);
}

/** The page learns of other devices' changes when it syncs (on focus, on reconnecting, every minute): this is the "reconnecting" event. */
export const poke = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

export const row = (page: Page, text: string) => page.getByTestId("row").filter({ hasText: text });

export async function editExpense(page: Page, rowText: string, fields: { amount?: string; note?: string }) {
  await page.goto("/expenses");
  await row(page, rowText).getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("#expense-amount")).toBeFocused(); // see fillAndVerify
  const amount = fields.amount ?? (await page.locator("#expense-amount").inputValue());
  const note = fields.note ?? (await page.locator("#expense-note").inputValue());
  await fillAndVerify(page, [["#expense-amount", amount], ["#expense-note", note]]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#expense-amount")).toHaveCount(0);
}

export async function addContribution(page: Page, amount: string) {
  await page.goto("/investments/f1");
  await page.getByRole("tab", { name: "Contributions" }).click(); // the fund page keeps its contributions on a tab
  await page.getByRole("button", { name: "Add contribution" }).click();
  await page.getByRole("dialog").locator('input[type="number"]').fill(amount);
  await page.getByRole("dialog").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Device A signs in with the guest data it already had and uploads it: the usual start of every scenario. */
export async function deviceWithUpload(browser: Browser, server: FakeServer, allow: RegExp[] = []): Promise<Device> {
  const A = await newDevice(browser, server, { initScript: GUEST, allow });
  await signIn(A.page);
  await A.page.getByTestId("choice-upload").click();
  await waitSynced(A.page);
  return A;
}

/** A second device that signs in with an empty guest storage and starts with the account's data. */
export async function secondDevice(browser: Browser, server: FakeServer, allow: RegExp[] = []): Promise<Device> {
  const B = await newDevice(browser, server, { initScript: EMPTY, allow });
  await signIn(B.page);
  await waitSynced(B.page);
  return B;
}

export const closeAll = async (...devices: Device[]) => {
  for (const d of devices) await d.context.close();
};
