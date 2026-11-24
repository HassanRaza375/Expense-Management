// Real-service check, run BY HAND: two real Chrome windows (two devices) on the real built app, the real server and the TEST database.
//   NUXT_PUBLIC_SYNC_ENABLED=1 npm run build && node scripts/live/syncBrowser.mjs      (then build again with the flag 0 for `npm run verify`)
// Device A has data from before it had an account and uploads it; device B starts empty. They add, edit and delete the same records, and the check looks at what each
// window shows AND what the database holds. Everything it creates is removed. Prints no secret.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { connect, resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`syncBrowser: REFUSED. ${target.error}`);
  process.exit(1);
}
const shell = readFileSync(path.join(root, ".output/public/index.html"), "utf8");
if (!/syncEnabled:(1|!0|true)/.test(shell)) {
  console.log("syncBrowser: the build has the flag OFF. Run: NUXT_PUBLIC_SYNC_ENABLED=1 npm run build");
  process.exit(1);
}
const work = mkdtempSync(path.join(tmpdir(), "hisaab-live-"));
await build({ stdin: { contents: `export { seedScript } from "./e2e/seed.ts";`, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: path.join(work, "seed.mjs"), logLevel: "error" });
const { seedScript } = await import(pathToFileURL(path.join(work, "seed.mjs")).href);

const PORT = "3035";
const BASE = `http://localhost:${PORT}`;
const RUN = randomBytes(4).toString("hex");
const EMAIL = `live-${RUN}-sync@example.test`;
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

const env = { ...process.env, PORT, NITRO_PORT: PORT, NUXT_PUBLIC_SYNC_ENABLED: "1", DATABASE_URL: target.url, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"), BETTER_AUTH_URL: BASE, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "", EMAIL_FROM: "" };
const server = spawn(process.execPath, [".output/server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const pg = await connect(target.url);
let browser;
let dbExpenses;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
  }
  check("the server starts", up);
  if (!up) throw new Error("server did not start");

  browser = await chromium.launch({ channel: "chrome" });
  const problems = { A: [], B: [] };
  async function device(name, script) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", timezoneId: "Asia/Karachi" });
    await ctx.addInitScript(script);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems[name].push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !/Service Worker registration blocked/.test(m.text())) problems[name].push(`[${m.type()}] ${m.text()}`);
    });
    return { ctx, page };
  }
  const synced = (p) => p.getByTestId("sync-status").and(p.locator('[data-status="synced"]')).waitFor({ timeout: 30000 });
  const row = (p, text) => p.getByTestId("row").filter({ hasText: text });
  const poke = (p) => p.evaluate(() => window.dispatchEvent(new Event("online")));
  dbExpenses = async () => (await pg.query(`SELECT d.id AS id, d.data->>'note' AS note, d.data->>'amount' AS amount, (d."deletedAt" IS NOT NULL) AS deleted, d."amountMinor"::text AS minor, d."dayKey" AS "dayKey" FROM "SyncDoc" d JOIN "User" u ON u.id = d."userId" WHERE u.email = $1 AND d.collection = 'expense' ORDER BY d.id`, [EMAIL])).rows;
  // `fill` focuses a field and inserts text into whatever is focused; the dialog's own autofocus can land late and send the text into the number Amount field. A person
  // cannot type that fast, so: fill, check that every value held, and try again if not.
  async function fillAndVerify(p, fields) {
    for (let attempt = 0; attempt < 8; attempt++) {
      for (const [sel, v] of fields) await p.locator(sel).fill(v);
      let held = true;
      for (const [sel, v] of fields) if ((await p.locator(sel).inputValue()) !== v) held = false;
      if (held) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("the form did not keep what was typed");
  }
  async function addExpense(p, amount, note, { navigate = true } = {}) {
    if (navigate) await p.goto(`${BASE}/expenses`);
    await p.getByTestId("add-expense").click();
    await p.locator("#expense-amount").waitFor();
    await p.waitForFunction(() => document.activeElement?.id === "expense-amount");
    await fillAndVerify(p, [["#expense-amount", amount], ["#expense-note", note]]);
    await p.getByRole("button", { name: "Add", exact: true }).click();
    await p.locator("#expense-amount").waitFor({ state: "detached" });
  }
  async function editExpense(p, rowText, fields) {
    await p.goto(`${BASE}/expenses`);
    await row(p, rowText).getByRole("button", { name: "Edit" }).click();
    await p.waitForFunction(() => document.activeElement?.id === "expense-amount");
    const amount = fields.amount ?? (await p.locator("#expense-amount").inputValue());
    const note = fields.note ?? (await p.locator("#expense-note").inputValue());
    await fillAndVerify(p, [["#expense-amount", amount], ["#expense-note", note]]);
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await p.locator("#expense-amount").waitFor({ state: "detached" });
  }

  console.log("device A signs up with the data it already had and uploads it");
  const A = await device("A", seedScript({ theme: "light" }));
  globalThis.__A = A.page;
  await A.page.goto(`${BASE}/account`);
  await A.page.getByTestId("mode-sign-up").click();
  await A.page.getByLabel("Name").fill("Live Sync");
  await A.page.getByLabel("Email").fill(EMAIL);
  await A.page.getByLabel("Password").fill(PASSWORD);
  await A.page.getByTestId("auth-submit").click();
  await A.page.getByTestId("first-sign-in").waitFor({ timeout: 20000 });
  check("the choice is offered, with this device's record count", /This device has \d+ saved records/.test(await A.page.getByTestId("first-sign-in").innerText()));
  await A.page.getByTestId("choice-upload").click();
  await synced(A.page);
  check("the upload finishes and the window says Synced", true);
  const rows1 = await dbExpenses();
  check("the database holds the expenses, in minor units, with the local day", rows1.length === 3 && rows1.find((r) => r.id === "e2")?.minor === "12000" && /^\d{4}-\d{2}-\d{2}$/.test(rows1[0].dayKey), JSON.stringify(rows1));
  const guestKept = await A.page.evaluate(() => JSON.parse(localStorage.getItem("hisaab:expenses") || "[]").length);
  check("the guest copy on device A is untouched", guestKept === 3);

  console.log("device B signs in with nothing and starts with the account's data");
  const B = await device("B", seedScript({ data: false }));
  globalThis.__B = B.page;
  await B.page.goto(`${BASE}/account`);
  await B.page.getByLabel("Email").fill(EMAIL);
  await B.page.getByLabel("Password").fill(PASSWORD);
  await B.page.getByTestId("auth-submit").click();
  await synced(B.page);
  await B.page.goto(`${BASE}/expenses`);
  await row(B.page, "Groceries").waitFor();
  check("B shows A's expenses", (await B.page.getByTestId("row").count()) >= 2);

  console.log("changes travel both ways, in the page, without a reload");
  await addExpense(A.page, "250", "Coffee with Sara");
  await synced(A.page);
  await B.page.goto(`${BASE}/expenses`);
  await poke(B.page);
  try {
    await row(B.page, "Coffee with Sara").waitFor({ timeout: 30000 });
  } catch (e) {
    const chip = await B.page.getByTestId("sync-status").getAttribute("data-status").catch(() => "none");
    const cache = await B.page.evaluate(() => { const h = JSON.parse(localStorage.getItem("hisaab:auth:hint") || "null"); return h ? (JSON.parse(localStorage.getItem("hisaab:u:" + h.userId + ":expenses") || "[]")).map((x) => x.note) : "no hint"; });
    const chipA = await A.page.getByTestId("sync-status").getAttribute("data-status").catch(() => "none");
    console.log("  diagnostics: B chip=" + chip + " A chip=" + chipA + " B cache notes=" + JSON.stringify(cache) + " db=" + JSON.stringify((await dbExpenses()).map((r) => r.note + (r.deleted ? "(deleted)" : ""))) + " problems B=" + JSON.stringify(problems.B).slice(0, 300));
    throw e;
  }
  check("an expense added on A appears on B", true);

  await Promise.all([editExpense(A.page, "Lunch", { amount: "175" }), editExpense(B.page, "Lunch", { note: "Lunch with Ali" })]);
  await synced(A.page);
  await synced(B.page);
  for (let i = 0; i < 3; i++) {
    await poke(A.page);
    await poke(B.page);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const lunch = (await dbExpenses()).find((r) => r.id === "e2");
  check("the same expense edited on both: the database has both edits", lunch.amount === "175" && lunch.note === "Lunch with Ali", JSON.stringify(lunch));
  await A.page.goto(`${BASE}/expenses`);
  await B.page.goto(`${BASE}/expenses`);
  check("and both windows show both edits", /175/.test(await row(A.page, "Lunch with Ali").innerText()) && /175/.test(await row(B.page, "Lunch with Ali").innerText()));

  await row(A.page, "Coffee with Sara").getByRole("button", { name: "Delete" }).click();
  await A.page.getByTestId("confirm-delete").click();
  const undo = A.page.getByRole("button", { name: "Undo" });
  await undo.hover();
  await synced(A.page);
  check("a deletion is a tombstone in the database", (await dbExpenses()).some((r) => r.note === null && r.deleted));
  await poke(B.page);
  await row(B.page, "Coffee with Sara").waitFor({ state: "detached", timeout: 30000 });
  check("and the other window drops it", true);
  await undo.click();
  await synced(A.page);
  await poke(B.page);
  await row(B.page, "Coffee with Sara").waitFor({ timeout: 30000 });
  check("Undo brings it back on both", (await dbExpenses()).filter((r) => !r.deleted && r.note === "Coffee with Sara").length === 1);

  console.log("offline");
  await B.page.goto(`${BASE}/expenses`); // the page is open (and loaded) when the connection drops
  await B.page.getByTestId("add-expense").waitFor();
  await B.ctx.setOffline(true);
  await addExpense(B.page, "40", "Written offline", { navigate: false });
  await B.page.getByTestId("sync-status").and(B.page.locator('[data-status="offline"]')).waitFor({ timeout: 30000 });
  check("an offline change is kept and the window says so", /waiting/.test(await B.page.getByTestId("sync-status").innerText()));
  await B.ctx.setOffline(false);
  await poke(B.page);
  await synced(B.page);
  check("when the network returns it goes up", (await dbExpenses()).some((r) => r.note === "Written offline" && !r.deleted));

  console.log("leaving");
  await B.page.goto(`${BASE}/account`);
  await Promise.all([B.page.waitForEvent("load"), B.page.getByTestId("sign-out").click()]);
  await B.page.getByTestId("auth-form").waitFor({ timeout: 20000 });
  const left = await B.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hisaab:u:") || k === "hisaab:auth:hint"));
  check("signing out removes the account's copy from the device", left.length === 0);

  const refused = /Failed to load resource/;
  check("no console error or warning in either window (besides blocked requests while offline)", problems.A.filter((p) => !refused.test(p)).length === 0 && problems.B.filter((p) => !refused.test(p)).length === 0, JSON.stringify(problems).slice(0, 400));
  check("the server log holds no password, no email and no record content", !log.includes(PASSWORD) && !log.includes("@example.test") && !log.includes("Groceries") && !log.includes("Coffee with Sara"));
} catch (e) {
  failures++;
  console.log(`syncBrowser: stopped (${String(e?.message ?? e).split("\n")[0]})`);
  try {
    // what each window and the database held at the moment it stopped
    const dump = async (name, page) => {
      if (!page) return;
      const chip = await page.getByTestId("sync-status").getAttribute("data-status").catch(() => "none");
      const label = await page.getByTestId("sync-status").innerText().catch(() => "");
      const cache = await page.evaluate(() => { const h = JSON.parse(localStorage.getItem("hisaab:auth:hint") || "null"); return h ? JSON.parse(localStorage.getItem("hisaab:u:" + h.userId + ":expenses") || "[]").map((x) => x.note) : "no hint"; }).catch(() => "?");
      const choiceError = await page.getByTestId("choice-error").innerText({ timeout: 500 }).catch(() => "");
      console.log(`  diagnostics ${name}: url=${page.url().replace(BASE, "")} chip=${chip} (${label.trim()}) cache notes=${JSON.stringify(cache)} choiceError=${JSON.stringify(choiceError)}`);
    };
    await dump("A", globalThis.__A);
    await dump("B", globalThis.__B);
    console.log("  diagnostics db: " + JSON.stringify((await dbExpenses?.()) ?? []).slice(0, 600));
  } catch {
    /* diagnostics are best effort */
  }
  console.log(log.split("\n").slice(-6).join("\n"));
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
  try {
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
  } catch (e) {
    console.log(`syncBrowser: clean-up problem (${e?.code ?? "error"})`);
  }
  await pg.end().catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nsyncBrowser: all checks passed, test data removed." : `\nsyncBrowser: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
