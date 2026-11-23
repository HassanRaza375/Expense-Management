// Real-service check, run BY HAND: the Account page in the installed Chrome, against the real built server, the TEST database and real Cloudinary (folder `hisaab-test`).
//   NUXT_PUBLIC_SYNC_ENABLED=1 npm run build && node scripts/live/accountBrowser.mjs      (then build again with the flag 0 for `npm run verify`)
// Proves the browser's requests match what the server really answers (the Playwright tests use a fake server). Everything it creates is removed. Prints no secret.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { v2 as cloudinary } from "cloudinary";
import { connect, resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`accountBrowser: REFUSED. ${target.error}`);
  process.exit(1);
}
// the build must have the flag ON (it is baked into the page): look for it in the prerendered shell
const shell = readFileSync(path.join(root, ".output/public/index.html"), "utf8");
if (!/syncEnabled:(1|!0|true)/.test(shell)) {
  console.log("accountBrowser: the build has the flag OFF. Run: NUXT_PUBLIC_SYNC_ENABLED=1 npm run build");
  process.exit(1);
}

const PORT = "3033";
const BASE = `http://localhost:${PORT}`;
const FOLDER = "hisaab-test";
const RUN = randomBytes(4).toString("hex");
const EMAIL = `live-${RUN}-browser@example.test`;
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
const NEW_PASSWORD = `${PASSWORD}-new`;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

const env = { ...process.env, PORT, NITRO_PORT: PORT, NUXT_PUBLIC_SYNC_ENABLED: "1", DATABASE_URL: target.url, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"), BETTER_AUTH_URL: BASE, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "", EMAIL_FROM: "", CLOUDINARY_FOLDER: FOLDER };
const server = spawn(process.execPath, [".output/server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const pg = await connect(target.url);
let userId = null;
let browser;

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
  }
  check("the server starts", up);
  if (!up) throw new Error("server did not start");

  browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => sessionStorage.setItem("hisaab:session-unlocked", "true"));
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !/Service Worker registration blocked/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`);
  });
  const t = (id) => page.getByTestId(id);

  console.log("create an account in the page");
  await page.goto(`${BASE}/settings`);
  await t("account-card").waitFor();
  check("Settings shows the optional account card", /optional/i.test(await t("account-card").innerText()));
  await page.goto(`${BASE}/account`);
  await t("auth-form").waitFor();
  check("the Account page says Google and email are not available yet", (await t("google-off").isVisible()) && (await t("email-off").isVisible()));
  await t("mode-sign-up").click();
  await page.getByLabel("Name").fill("Live Browser");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await t("auth-submit").click();
  await t("account-email").waitFor({ timeout: 15000 });
  check("signed in right after sign-up", (await t("account-email").innerText()) === EMAIL);
  userId = (await pg.query(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0]?.id ?? null;
  check("the account is in the database as an ordinary user", (await pg.query(`SELECT role FROM "User" WHERE id = $1`, [userId])).rows[0]?.role === "user");

  // a device with nothing on it starts with the account's data straight away: the page reloads into account mode. Wait for that before touching the page.
  await page.getByTestId("sync-status").and(page.locator('[data-status="synced"]')).waitFor({ timeout: 30000 });
  await t("account-email").waitFor();

  console.log("profile photo");
  const avatar = t("user-avatar").first();
  check("a generated avatar is shown first", ((await avatar.getAttribute("src")) ?? "").startsWith("data:image/svg+xml"));
  const picture = await page.screenshot(); // any real PNG will do
  await t("photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: picture });
  await t("crop-view").waitFor();
  await page.getByLabel("Zoom").fill("1.5");
  await t("crop-save").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="user-avatar"]')?.getAttribute("src")?.startsWith("https://res.cloudinary.com/"), null, { timeout: 30000 });
  check("after saving, the avatar is the Cloudinary URL", true);
  await page.waitForFunction(() => {
    const i = document.querySelector('[data-testid="user-avatar"]');
    return i && i.complete && i.naturalWidth > 0;
  }, null, { timeout: 30000 });
  check("and the picture really loads from Cloudinary", true);
  const stored = (await pg.query(`SELECT "avatarPublicId" FROM "User" WHERE id = $1`, [userId])).rows[0];
  check("the database holds the public id under hisaab-test/u/<id>", stored.avatarPublicId === `${FOLDER}/u/${userId}/avatar`, String(stored.avatarPublicId));
  await page.reload();
  await t("account-email").waitFor();
  check("after a reload the account and photo are still there", ((await t("user-avatar").first().getAttribute("src")) ?? "").startsWith("https://res.cloudinary.com/"));
  await t("photo-remove").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="user-avatar"]')?.getAttribute("src")?.startsWith("data:image/svg+xml"));
  check("removing the photo brings back the generated avatar", (await pg.query(`SELECT "avatarPublicId" FROM "User" WHERE id = $1`, [userId])).rows[0].avatarPublicId === null);

  console.log("password, sign out, sign in");
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await t("password-save").click();
  await page.getByText("Password changed").waitFor({ timeout: 10000 });
  check("the password is changed", true);
  await t("sign-out").click();
  await t("auth-form").waitFor();
  check("signed out shows the form", true);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await t("auth-submit").click();
  await t("auth-message").waitFor();
  check("the OLD password is refused with a plain message", (await t("auth-message").innerText()) === "That email and password do not match.");
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await t("auth-submit").click();
  await t("account-email").waitFor({ timeout: 15000 });
  check("the new password signs in", true);

  await page.getByTestId("sync-status").and(page.locator('[data-status="synced"]')).waitFor({ timeout: 30000 }); // signing in again reloads into account mode
  await t("account-email").waitFor();

  console.log("the data on this device");
  const before = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hisaab:") && k !== "hisaab:session-unlocked").length);
  console.log(`  (this browser profile holds ${before} hisaab: keys; none were written by the account area)`);

  console.log("delete the account in the page");
  await page.getByTestId("photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: picture });
  await t("crop-view").waitFor();
  await t("crop-save").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="user-avatar"]')?.getAttribute("src")?.startsWith("https://res.cloudinary.com/"), null, { timeout: 30000 });
  await t("delete-confirm").fill("not-my-address@example.test");
  check("the Delete button stays disabled for the wrong address", await t("delete-account").isDisabled());
  await t("delete-confirm").fill(EMAIL);
  await t("delete-account").click();
  await t("auth-form").waitFor({ timeout: 20000 });
  check("after deleting, the page is signed out", true);
  check("the user, sessions and sign-in methods are gone from the database", (await pg.query(`SELECT (SELECT count(*) FROM "User" WHERE id = $1)::int + (SELECT count(*) FROM "Session" WHERE "userId" = $1)::int + (SELECT count(*) FROM "Account" WHERE "userId" = $1)::int AS n`, [userId])).rows[0].n === 0);
  cloudinary.config({ ...cldConfig(), secure: true });
  const left = await cloudinary.api.resources({ type: "upload", prefix: `${FOLDER}/u/${userId}`, resource_type: "image" });
  check("and nothing is left in Cloudinary", left.resources.length === 0, String(left.resources.length));

  // exactly one is expected: Chrome logs the 401 of the old-password attempt above (the page itself shows a plain message). Anything else is a problem.
  const refusal = /Failed to load resource: the server responded with a status of 401/;
  const unexpected = problems.filter((p) => !refusal.test(p));
  check("no console error, warning or page error in the whole walk (besides the one expected 401)", unexpected.length === 0 && problems.filter((p) => refusal.test(p)).length === 1, problems.join(" | ").slice(0, 400));
} catch (e) {
  failures++;
  console.log(`accountBrowser: stopped (${String(e?.message ?? e).split("\n")[0]})`);
  console.log(log.split("\n").slice(-6).join("\n"));
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
  try {
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
    if (userId) {
      cloudinary.config({ ...cldConfig(), secure: true });
      for (const type of ["upload", "authenticated"]) await cloudinary.api.delete_resources_by_prefix(`${FOLDER}/u/${userId}`, { type }).catch(() => undefined);
      await cloudinary.api.delete_folder(`${FOLDER}/u/${userId}`).catch(() => undefined);
    }
  } catch (e) {
    console.log(`accountBrowser: clean-up problem (${e?.code ?? "error"})`);
  }
  await pg.end().catch(() => undefined);
}
function cldConfig() {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL ?? "");
  return m ? { api_key: m[1], api_secret: m[2], cloud_name: m[3] } : {};
}
console.log(failures === 0 ? "\naccountBrowser: all checks passed, test data removed." : `\naccountBrowser: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
