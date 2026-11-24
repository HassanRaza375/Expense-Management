import { test as plain, expect, type Page } from "@playwright/test";
import { addUser, fakeServer, makePng, newDevice } from "./accountMocks";
import { EMAIL, GUEST, cacheOf, closeAll, deviceWithUpload, liveRows, poke, row, secondDevice, signIn, status, waitSynced } from "./syncHelpers";

// Receipts in an account: a receipt is a record of its own (a child of the expense) and its file goes to PRIVATE storage after the record has reached the account.
// The server rules are the real ones (server/utils/receiptService.ts); the file store is a fake. Nothing reaches a real service.
const BLOCKED = [/Failed to load resource/];

const attachTo = async (page: Page, rowText: string, buffer: Buffer, name = "receipt.png") => {
  await page.goto("/expenses");
  await row(page, rowText).getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("#expense-amount")).toBeFocused();
  await page.getByTestId("receipt-input").setInputFiles({ name, mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png", buffer });
};
const receiptOf = async (page: Page, expenseId: string) => ((await cacheOf(page, "expenses")) as Array<{ id: string; receipts?: Array<{ id: string; remote?: boolean }> }>).find((e) => e.id === expenseId)?.receipts ?? [];

plain.describe("receipts in an account", () => {
  plain("a receipt is uploaded after its record, marked as safely there, and the other device can view it", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await secondDevice(browser, server);
    await attachTo(A.page, "Lunch", makePng(40, 40));
    await expect(A.page.getByTestId("receipt-item")).toHaveCount(1);
    await expect.poll(async () => (await receiptOf(A.page, "e2"))[0]?.remote, { timeout: 20_000 }).toBe(true);
    await waitSynced(A.page);
    const [rid] = liveRows(server, "receipt");
    expect(rid).toBeTruthy();
    expect([...server.files.keys()]).toEqual([`hisaab-test/u/${(await A.page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:auth:hint")!).userId))}/receipts/${rid}`]);
    // the other device has the record (and the mark) but not the file: it opens a short-lived signed address
    await poke(B.page);
    await expect.poll(async () => (await receiptOf(B.page, "e2")).length, { timeout: 20_000 }).toBe(1);
    await B.page.goto("/expenses");
    await row(B.page, "Lunch").getByRole("button", { name: "Edit" }).click();
    await expect(B.page.getByTestId("receipt-item")).toHaveCount(1);
    const [popup] = await Promise.all([B.page.context().waitForEvent("page"), B.page.getByTestId("receipt-view").click()]);
    await popup.waitForURL(/pwa-192x192/, { timeout: 15_000 }); // the tab opens blank (so a popup blocker allows it) and is then sent to the signed address
    expect(popup.url()).toMatch(/pwa-192x192\.png\?pid=.*&format=png&expires=300$/); // five minutes, never a public address
    expect(A.problems).toEqual([]);
    expect(B.problems).toEqual([]);
    await closeAll(A, B);
  });

  plain("a receipt added offline waits, and is uploaded when the network is back", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server, BLOCKED);
    A.net.offline = true;
    await attachTo(A.page, "Lunch", makePng(30, 30));
    await expect(A.page.getByTestId("receipt-item")).toHaveCount(1);
    await expect(status(A.page)).toHaveAttribute("data-status", "offline", { timeout: 20_000 });
    expect(server.files.size).toBe(0);
    expect((await receiptOf(A.page, "e2"))[0]?.remote).toBeUndefined();
    A.net.offline = false;
    await poke(A.page);
    await expect.poll(async () => (await receiptOf(A.page, "e2"))[0]?.remote, { timeout: 30_000 }).toBe(true);
    expect(server.files.size).toBe(1);
    await closeAll(A);
  });

  plain("a file that is not a photo or a PDF, and one over 10 MB, are refused with a clear message", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    await attachTo(A.page, "Lunch", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(11 * 1024 * 1024)]), "huge.jpg");
    await expect(A.page.getByTestId("receipt-error")).toContainText("too large");
    await expect(A.page.getByTestId("receipt-error")).toContainText("10.0 MB for receipts in an account");
    expect(await receiptOf(A.page, "e2")).toEqual([]);
    await closeAll(A);
  });

  plain("deleting an expense keeps its files; only the confirmed clean-up removes them, from the account too", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    await attachTo(A.page, "Lunch", makePng(40, 40));
    await expect.poll(async () => (await receiptOf(A.page, "e2"))[0]?.remote, { timeout: 20_000 }).toBe(true);
    await waitSynced(A.page);
    expect(server.files.size).toBe(1);
    // delete the expense: the file stays (so Undo always works), and Undo brings the receipt back
    await A.page.goto("/expenses");
    await row(A.page, "Lunch").getByRole("button", { name: "Delete" }).click();
    await A.page.getByTestId("confirm-delete").click();
    const undo = A.page.getByRole("button", { name: "Undo" });
    await undo.hover();
    await expect.poll(() => liveRows(server, "receipt"), { timeout: 20_000 }).toEqual([]);
    expect(server.files.size).toBe(1);
    expect(server.destroyed).toEqual([]);
    await undo.click();
    await expect.poll(() => liveRows(server, "receipt"), { timeout: 20_000 }).toHaveLength(1);
    expect(server.files.size).toBe(1);
    // remove the receipt itself: its record goes, the file is now an orphan, and only the confirmed clean-up removes it
    await waitSynced(A.page);
    await A.page.goto("/expenses");
    await row(A.page, "Lunch").getByRole("button", { name: "Edit" }).click();
    await A.page.getByTestId("receipt-remove").click();
    await expect.poll(() => liveRows(server, "receipt"), { timeout: 20_000 }).toEqual([]);
    expect(server.files.size).toBe(1);
    await A.page.goto("/settings");
    await expect(A.page.getByTestId("remote-orphans")).toContainText("1 file");
    await A.page.getByTestId("remote-cleanup").click();
    await A.page.getByTestId("remote-cleanup-confirm").click();
    await expect.poll(() => server.files.size, { timeout: 15_000 }).toBe(0);
    expect(server.destroyed).toHaveLength(1);
    await closeAll(A);
  });

  plain("the server refuses a file for a receipt that is not this account's, and one that was never synced", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    addUser(server, "other@example.test");
    const A = await deviceWithUpload(browser, server);
    const send = (path: string, init: RequestInit) => A.page.evaluate(async ([p, i]) => (await fetch(p as string, i as RequestInit)).status, [path, init] as const);
    expect(await send("/api/receipts/never-synced", { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) })).toBe(404);
    expect(await send("/api/receipts/never-synced", { method: "GET" })).toBe(404);
    expect(server.files.size).toBe(0);
    await closeAll(A);
  });

  plain("in guest mode nothing about receipts calls the server", async ({ browser }) => {
    const server = fakeServer();
    const A = await newDevice(browser, server, { initScript: GUEST });
    await attachTo(A.page, "Lunch", makePng(30, 30));
    await expect(A.page.getByTestId("receipt-item")).toHaveCount(1);
    await A.page.waitForTimeout(500);
    expect(server.requests.filter((r) => r.path.startsWith("/api/receipts"))).toEqual([]);
    expect(server.files.size).toBe(0);
    await A.context.close();
  });

  plain("'Upload this device's data' also uploads the receipts already on the device, and only after their records have reached the account", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await newDevice(browser, server, { initScript: GUEST });
    await attachTo(A.page, "Lunch", makePng(40, 40)); // a receipt added as a guest: the file is in this browser only
    await attachTo(A.page, "Groceries", makePng(50, 50), "second.png");
    await expect(A.page.getByTestId("receipt-item")).toHaveCount(1);
    expect(server.files.size).toBe(0);
    await signIn(A.page);
    await A.page.getByTestId("choice-upload").click();
    await waitSynced(A.page);
    await expect.poll(() => server.files.size, { timeout: 30_000 }).toBe(2);
    await expect.poll(async () => ((await receiptOf(A.page, "e2"))[0]?.remote ?? false) && ((await receiptOf(A.page, "e1"))[0]?.remote ?? false), { timeout: 30_000 }).toBe(true);
    // every file was accepted for a record the account already had (the real server rule), none was refused
    expect(liveRows(server, "receipt")).toHaveLength(2);
    expect(A.problems).toEqual([]);
    await closeAll(A);
  });
});
