import { test as plain, expect, type Page } from "@playwright/test";
import { addUser, fakeServer, newDevice } from "./accountMocks";
import { EMAIL, GUEST, addContribution, addExpense, cacheOf, closeAll, deviceWithUpload, editExpense, guestOf, liveRows, poke, row, secondDevice, signIn, status, waitSynced } from "./syncHelpers";

// The scenarios the brief names (the same expense edited on both devices, fund contributions on both, deletion and Undo, offline then reconnect) and the safety nets
// around them (a blank device, an expired session, the wrong account, an old app, signing out with unsent changes, deleting the account).
// Chrome logs every refused or blocked request as a console error; a device that is made to fail on purpose says so with `allow`.
const BLOCKED = [/Failed to load resource/];

plain.describe("the scenarios from the brief", () => {
  plain("the same expense edited on both devices: both edits survive, and the devices agree", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await secondDevice(browser, server, BLOCKED);
    await B.page.goto("/expenses");
    await expect(row(B.page, "Lunch")).toBeVisible();
    B.net.offline = true; // B does not know about A's edit yet
    await editExpense(B.page, "Lunch", { note: "Lunch with Ali" });
    await editExpense(A.page, "Lunch", { amount: "175" });
    await waitSynced(A.page);
    B.net.offline = false;
    await poke(B.page);
    await waitSynced(B.page);
    await poke(A.page);
    for (const d of [A, B]) {
      await expect.poll(async () => (await cacheOf(d.page, "expenses")).find((e: { id: string }) => e.id === "e2")).toMatchObject({ amount: 175, note: "Lunch with Ali" });
    }
    await B.page.goto("/expenses");
    await expect(row(B.page, "Lunch with Ali")).toContainText("175");
    expect(A.problems).toEqual([]);
    expect(B.problems).toEqual([]);
    await closeAll(A, B);
  });

  plain("fund contributions added on both devices: none overwrites the other", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await secondDevice(browser, server, BLOCKED);
    B.net.offline = true;
    await addContribution(B.page, "300");
    await addContribution(A.page, "200");
    await waitSynced(A.page);
    B.net.offline = false;
    await poke(B.page);
    await waitSynced(B.page);
    await poke(A.page);
    await expect.poll(() => liveRows(server, "fundContribution")).toHaveLength(3); // the one it started with, and one from each device
    for (const d of [A, B]) {
      await expect.poll(async () => ((await cacheOf(d.page, "investments"))[0].contributions as Array<{ amount: number }>).map((c) => c.amount).sort((a, b) => a - b)).toEqual([200, 300, 1000]);
    }
    await closeAll(A, B);
  });

  plain("a deletion reaches the other device, and Undo brings the same record back to both", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    const B = await secondDevice(browser, server);
    await B.page.goto("/expenses");
    await expect(row(B.page, "Lunch")).toBeVisible();
    await A.page.goto("/expenses");
    await row(A.page, "Lunch").getByRole("button", { name: "Delete" }).click();
    await A.page.getByTestId("confirm-delete").click();
    const undo = A.page.getByRole("button", { name: "Undo" });
    await undo.hover(); // the toast stays while the pointer is on it
    await expect.poll(() => liveRows(server, "expense")).toEqual(["e1", "e3"]); // sent: the record is a tombstone on the account
    await poke(B.page);
    await expect(row(B.page, "Lunch")).toHaveCount(0, { timeout: 15_000 });
    await undo.click();
    await expect.poll(() => liveRows(server, "expense"), { timeout: 15_000 }).toEqual(["e1", "e2", "e3"]); // the same id is back
    await poke(B.page);
    await expect(row(B.page, "Lunch")).toBeVisible({ timeout: 15_000 });
    await closeAll(A, B);
  });
});

plain.describe("the safety nets", () => {
  /** Removes this device's copy of the data (as a blank or damaged browser would), then reloads. The account still has everything. */
  async function blankTheCache(page: Page) {
    await page.evaluate(() => {
      const hint = JSON.parse(localStorage.getItem("hisaab:auth:hint") || "null");
      for (const k of Object.keys(localStorage)) if (k.startsWith(`hisaab:u:${hint.userId}:`) && !k.endsWith(":sync:ready")) localStorage.removeItem(k);
    });
    await page.reload();
  }

  plain("a device that suddenly has nothing does not empty the account: the deletions are held until you decide", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    expect(server.repo.state.rows.size).toBeGreaterThan(15);
    await blankTheCache(A.page);
    await expect(status(A.page)).toHaveAttribute("data-status", "held", { timeout: 20_000 });
    expect([...server.repo.state.rows.values()].filter((r) => r.deleted)).toHaveLength(0); // nothing was sent
    await A.page.goto("/settings");
    await expect(A.page.getByTestId("sync-held")).toContainText("about to delete");
    await Promise.all([A.page.waitForEvent("load"), A.page.getByTestId("held-restore").click()]); // "Restore from my account"
    await waitSynced(A.page);
    expect((await cacheOf(A.page, "expenses")).map((e: { id: string }) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect([...server.repo.state.rows.values()].filter((r) => r.deleted)).toHaveLength(0);

    await blankTheCache(A.page);
    await expect(status(A.page)).toHaveAttribute("data-status", "held", { timeout: 20_000 });
    await A.page.goto("/settings");
    await A.page.getByTestId("held-confirm").click(); // "Delete them from my account too"
    await expect.poll(() => [...server.repo.state.rows.values()].filter((r) => !r.deleted).length, { timeout: 15_000 }).toBe(0);
    await closeAll(A);
  });

  plain("a session that ends keeps the data and the changes, and signing in again carries on without a reload", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await newDevice(browser, server, { initScript: GUEST, allow: BLOCKED });
    await signIn(A.page);
    await A.page.getByTestId("choice-upload").click();
    await waitSynced(A.page);
    A.net.session = null; // the session expired
    await addExpense(A.page, "77", "Written while signed out");
    await expect(status(A.page)).toHaveAttribute("data-status", "signedOut", { timeout: 20_000 });
    await expect(status(A.page)).toContainText("Sign in to sync");
    expect(liveRows(server, "expense")).toHaveLength(3);
    await A.page.goto("/expenses");
    await expect(row(A.page, "Written while signed out")).toBeVisible(); // still here
    await signIn(A.page); // the same account again
    await A.page.goto("/expenses");
    await poke(A.page);
    await expect.poll(() => liveRows(server, "expense"), { timeout: 20_000 }).toHaveLength(4);
    await waitSynced(A.page);
    await closeAll(A);
  });

  plain("another account signed in on this browser is never synced into", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const other = addUser(server, "someone.else@example.test");
    const A = await deviceWithUpload(browser, server, BLOCKED);
    A.net.session = "someone.else@example.test"; // the session cookie now belongs to somebody else
    await addExpense(A.page, "5", "Must not reach the other account");
    await expect(status(A.page)).toHaveAttribute("data-status", "mismatch", { timeout: 20_000 });
    await expect(status(A.page)).toContainText("Wrong account");
    expect([...server.repo.state.rows.keys()].filter((k) => k.startsWith(`${other.id}\u0000`))).toEqual([]);
    expect(server.repo.state.cursors.has(other.id)).toBe(false);
    await closeAll(A);
  });

  plain("an app that is older than the server is told to update, not left failing", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server, BLOCKED);
    server.forceSchemaMismatch = true;
    await addExpense(A.page, "5", "Needs an update");
    await expect(status(A.page)).toHaveAttribute("data-status", "updateRequired", { timeout: 20_000 });
    await expect(status(A.page)).toContainText("Update needed");
    await closeAll(A);
  });

  plain("signing out with changes that have not reached the account asks first, and 'Stay' keeps everything", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server, BLOCKED);
    A.net.offline = true;
    await addExpense(A.page, "12", "Not uploaded yet");
    await expect(status(A.page)).toHaveAttribute("data-status", "offline", { timeout: 20_000 });
    await A.page.goto("/account");
    await A.page.getByTestId("sign-out").click();
    await expect(A.page.getByTestId("leave-blocked")).toContainText("not reached your account");
    await A.page.getByTestId("leave-stay").click();
    await expect(A.page.getByTestId("leave-blocked")).toHaveCount(0);
    expect((await cacheOf(A.page, "expenses")).some((e: { note: string }) => e.note === "Not uploaded yet")).toBe(true);
    await A.page.getByTestId("sign-out").click();
    const guestBefore = await guestOf(A.page, "expenses");
    await Promise.all([A.page.waitForEvent("load"), A.page.getByTestId("leave-anyway").click()]); // signing out works offline: this device lets go of the account's copy
    await expect(A.page.getByTestId("sync-status")).toHaveCount(0);
    const left = await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hisaab:u:") || k === "hisaab:auth:hint"));
    expect(left).toEqual([]);
    expect(await guestOf(A.page, "expenses")).toEqual(guestBefore); // the guest data is exactly as it was
    expect(liveRows(server, "expense")).toHaveLength(3); // the unsent change was never sent: that is what "anyway" accepted
    await closeAll(A);
  });

  plain("deleting the account in account mode saves a backup file first, then returns to guest mode with the guest data intact", async ({ browser }) => {
    const server = fakeServer();
    addUser(server, EMAIL);
    const A = await deviceWithUpload(browser, server);
    await addExpense(A.page, "250", "Only in the account");
    await waitSynced(A.page);
    const guestBefore = await guestOf(A.page, "expenses");
    await A.page.goto("/account");
    await A.page.getByTestId("delete-confirm").fill(EMAIL);
    const [download] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("delete-account").click()]);
    expect(download.suggestedFilename()).toMatch(/^hisaab-account-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8"));
    expect(file.kind).toBe("hisaab-full-backup");
    expect(JSON.stringify(file)).toContain("Only in the account"); // the account's data is in the backup
    await expect(A.page.getByTestId("auth-form")).toBeVisible({ timeout: 20_000 });
    expect(server.users.has(EMAIL)).toBe(false);
    expect(await guestOf(A.page, "expenses")).toEqual(guestBefore);
    const left = await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hisaab:u:") || k === "hisaab:auth:hint"));
    expect(left).toEqual([]);
    await closeAll(A);
  });
});
