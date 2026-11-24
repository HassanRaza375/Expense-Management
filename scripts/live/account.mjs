// Real-service check for Phase 4, run BY HAND (needs `npm run build` first): `node scripts/live/account.mjs`.
// Starts the built server (sync flag ON) on a spare port against the TEST database (scripts/live/testDb.mjs) and real Cloudinary under the folder `hisaab-test`,
// then walks the account flows through HTTP: sign up, sign in/out, roles cannot be forged, the profile photo, CSRF refusal, disabling, rate limit, account deletion
// (database rows AND Cloudinary files), the seed script. Everything it creates is removed at the end, including after a failure. Prints no secret.
//
// BETTER_AUTH_SECRET is generated for this run only (never stored) when .env does not have one. Fake addresses use the reserved `.test` domain.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";
import { connect, resolveTestDb } from "./testDb.mjs";
import { seedSuperAdmin } from "../lib/seedSuperAdmin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`account: REFUSED. ${target.error}`);
  process.exit(1);
}
const PORT = "3032";
const BASE = `http://localhost:${PORT}`;
const FOLDER = "hisaab-test";
const RUN = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
const email = (n) => `live-${RUN}-${n}@example.test`;
// a valid 1 x 1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

// ---- a server on the test database, with a temporary secret ----
const env = {
  ...process.env,
  PORT,
  NITRO_PORT: PORT,
  NUXT_PUBLIC_SYNC_ENABLED: "1",
  DATABASE_URL: target.url,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"),
  BETTER_AUTH_URL: BASE,
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  CLOUDINARY_FOLDER: FOLDER,
};
const server = spawn(process.execPath, [".output/server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

// ---- a tiny browser: cookies + a same-origin Origin header ----
let ipCounter = 10;
function client() {
  const jar = new Map();
  const ip = `10.20.30.${ipCounter++}`; // each simulated browser has its own address (the rate limit is per address; a real host forwards the client's)
  return async function call(method, url, { json, body, headers = {}, origin = BASE } = {}) {
    const h = { "x-forwarded-for": ip, ...headers };
    if (origin) h.origin = origin;
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (json !== undefined) {
      h["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    const res = await fetch(BASE + url, { method, headers: h, body });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) jar.delete(name);
      else jar.set(name, value);
    }
    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [] };
  };
}

const pg = await connect(target.url);
const created = []; // user ids to remove at the end

async function cleanup() {
  try {
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
    for (const id of created) {
      cloudinary.config({ ...cldConfig(), secure: true });
      for (const type of ["upload", "authenticated"]) await cloudinary.api.delete_resources_by_prefix(`${FOLDER}/u/${id}`, { type }).catch(() => undefined);
      await cloudinary.api.delete_folder(`${FOLDER}/u/${id}`).catch(() => undefined);
    }
  } catch (e) {
    console.log(`account: clean-up problem (${e?.code ?? "error"})`);
  }
}
function cldConfig() {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL ?? "");
  return m ? { api_key: m[1], api_secret: m[2], cloud_name: m[3] } : {};
}

try {
  // wait for the server
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
  }
  check("the server starts and reaches the test database", up);
  if (!up) throw new Error("server did not start");

  const anon = client();
  console.log("signed out");
  check("GET /api/account is 401", (await anon("GET", "/api/account")).status === 401);
  check("DELETE /api/account is 401", (await anon("DELETE", "/api/account", { json: { confirm: "x" } })).status === 401);
  check("POST /api/account/avatar is 401", (await anon("POST", "/api/account/avatar", { body: PNG })).status === 401);
  const sess0 = await anon("GET", "/api/account/session");
  check("GET /api/account/session answers 200 with a null profile when signed out", sess0.status === 200 && sess0.data?.profile === null, JSON.stringify(sess0.data));
  const st = await anon("GET", "/api/account/status");
  check("status says which sign-in options exist (booleans only)", st.status === 200 && typeof st.data.google === "boolean" && typeof st.data.email === "boolean", JSON.stringify(st.data));

  console.log("sign up");
  const A = client();
  const short = await A("POST", "/api/auth/sign-up/email", { json: { name: "Live A", email: email("a"), password: "short" } });
  check("a short password is refused", short.status === 400, String(short.status));
  // a forged privileged field must either be refused, or ignored: whatever the status, the account that exists afterwards is an ordinary, enabled, unverified user
  for (const field of [{ role: "superadmin" }, { disabled: true }, { avatarPublicId: "x" }, { emailVerified: true }]) {
    const name = Object.keys(field)[0];
    const f = await client()("POST", "/api/auth/sign-up/email", { json: { name: "Live X", email: email("x"), password: PASSWORD, ...field } });
    const made = (await pg.query(`SELECT id, role, disabled, "emailVerified", "avatarPublicId" FROM "User" WHERE email = $1`, [email("x")])).rows[0];
    if (made) created.push(made.id);
    const safe = !made || (made.role === "user" && made.disabled === false && made.emailVerified === false && made.avatarPublicId === null);
    check(`forging ${name} in the sign-up body gets no privilege (status ${f.status}, ${made ? "account made as an ordinary user" : "no account made"})`, safe, JSON.stringify(made));
    if (made) await pg.query(`DELETE FROM "User" WHERE id = $1`, [made.id]);
  }
  const forged = await A("POST", "/api/auth/sign-up/email", { json: { name: "Live A", email: email("a"), password: PASSWORD } });
  check("sign-up works", forged.status === 200, `${forged.status} ${JSON.stringify(forged.data)?.slice(0, 120)}`);
  const cookieFlags = forged.setCookie.join(" ").toLowerCase();
  check("the session cookie is HttpOnly and SameSite", cookieFlags.includes("httponly") && cookieFlags.includes("samesite"));
  const me = await A("GET", "/api/account");
  check("the profile is the new account", me.status === 200 && me.data.email === email("a"), JSON.stringify(me.data));
  const sess1 = await A("GET", "/api/account/session");
  check("and /api/account/session returns the same profile", sess1.status === 200 && sess1.data?.profile?.email === email("a") && sess1.data.profile.role === "user", JSON.stringify(sess1.data));
  check("the new account is an ordinary user", me.data?.role === "user", me.data?.role);
  const row = (await pg.query(`SELECT id, role, disabled, "avatarPublicId" FROM "User" WHERE email = $1`, [email("a")])).rows[0];
  created.push(row?.id);
  check("in the database: role user, enabled, no photo", row?.role === "user" && row?.disabled === false && row?.avatarPublicId === null);
  const acct = (await pg.query(`SELECT password FROM "Account" WHERE "userId" = $1 AND "providerId" = 'credential'`, [row.id])).rows[0];
  check("the password is stored as a hash, not as text", Boolean(acct?.password) && acct.password !== PASSWORD && !acct.password.includes(PASSWORD));
  const dup = await client()("POST", "/api/auth/sign-up/email", { json: { name: "Again", email: email("a"), password: PASSWORD } });
  check("the same email cannot sign up twice", dup.status >= 400 && dup.status < 500, String(dup.status));

  console.log("another origin cannot act as the user (CSRF)");
  check("avatar upload from another origin is refused", (await A("POST", "/api/account/avatar", { body: PNG, origin: "https://evil.example" })).status === 403);
  check("account delete from another origin is refused", (await A("DELETE", "/api/account", { json: { confirm: email("a") }, origin: "https://evil.example" })).status === 403);
  check("a state-changing request with no Origin and no Sec-Fetch-Site is refused", (await A("POST", "/api/account/avatar", { body: PNG, origin: null })).status === 403);

  console.log("profile photo (real Cloudinary, folder hisaab-test)");
  check("a text file is refused (415)", (await A("POST", "/api/account/avatar", { body: Buffer.from("hello world, not a picture"), headers: { "content-type": "image/png" } })).status === 415);
  check("a file over 512 KB is refused (413)", (await A("POST", "/api/account/avatar", { body: Buffer.alloc(600 * 1024, 1), headers: { "content-type": "image/jpeg" } })).status === 413);
  const up1 = await A("POST", "/api/account/avatar", { body: PNG, headers: { "content-type": "image/png" } });
  check("a picture is accepted and a Cloudinary URL comes back", up1.status === 200 && /^https:\/\/res\.cloudinary\.com\//.test(up1.data?.avatarUrl ?? ""), `${up1.status} ${JSON.stringify(up1.data)?.slice(0, 150)}`);
  if (up1.data?.avatarUrl) {
    const img = await fetch(up1.data.avatarUrl);
    check("the photo is served from Cloudinary", img.ok && (img.headers.get("content-type") ?? "").startsWith("image/"), String(img.status));
    const stored = (await pg.query(`SELECT "avatarPublicId" FROM "User" WHERE id = $1`, [row.id])).rows[0];
    check("it lives under hisaab-test/u/<id>/avatar", stored.avatarPublicId === `${FOLDER}/u/${row.id}/avatar`, stored.avatarPublicId);
  }
  const rm = await A("DELETE", "/api/account/avatar");
  check("removing the photo clears it", rm.status === 200 && rm.data.avatarUrl === null);
  const afterRm = (await pg.query(`SELECT "avatarPublicId" FROM "User" WHERE id = $1`, [row.id])).rows[0];
  check("and the database forgets it", afterRm.avatarPublicId === null);

  console.log("sign out / sign in");
  await A("POST", "/api/auth/sign-out", { json: {} });
  check("after sign-out the profile is 401", (await A("GET", "/api/account")).status === 401);
  const bad = await A("POST", "/api/auth/sign-in/email", { json: { email: email("a"), password: "Wrong-password-123" } });
  check("a wrong password is refused", bad.status === 401, String(bad.status));
  const good = await A("POST", "/api/auth/sign-in/email", { json: { email: email("a"), password: PASSWORD } });
  check("the right password signs in", good.status === 200);

  console.log("name and password (the routes the Account page calls)");
  const upd = await A("POST", "/api/auth/update-user", { json: { name: "Live A2" } });
  check("update-user changes the name", upd.status === 200 && (await A("GET", "/api/account")).data?.name === "Live A2", String(upd.status));
  for (const field of [{ role: "superadmin" }, { disabled: false }, { avatarPublicId: "x" }, { email: "other@example.test" }]) {
    const f = await A("POST", "/api/auth/update-user", { json: field });
    const now = (await pg.query(`SELECT role, disabled, email, "avatarPublicId" FROM "User" WHERE id = $1`, [row.id])).rows[0];
    check(`update-user cannot change ${Object.keys(field)[0]} (status ${f.status})`, now.role === "user" && now.disabled === false && now.email === email("a") && now.avatarPublicId === null, JSON.stringify(now));
  }
  const wrongCp = await A("POST", "/api/auth/change-password", { json: { currentPassword: "Wrong-password-123", newPassword: PASSWORD + "x", revokeOtherSessions: true } });
  check("change-password with the wrong current password is refused", wrongCp.status === 400, String(wrongCp.status));
  const cp = await A("POST", "/api/auth/change-password", { json: { currentPassword: PASSWORD, newPassword: PASSWORD + "x", revokeOtherSessions: true } });
  check("change-password with the right one works", cp.status === 200, String(cp.status));
  const A2 = client();
  check("the new password signs in", (await A2("POST", "/api/auth/sign-in/email", { json: { email: email("a"), password: PASSWORD + "x" } })).status === 200);
  check("the old password no longer does", (await client()("POST", "/api/auth/sign-in/email", { json: { email: email("a"), password: PASSWORD } })).status === 401);

  console.log("another account cannot reach this one");
  const B = client();
  await B("POST", "/api/auth/sign-up/email", { json: { name: "Live B", email: email("b"), password: PASSWORD } });
  const meB = await B("GET", "/api/account");
  check("B sees only B", meB.status === 200 && meB.data.email === email("b"));
  created.push((await pg.query(`SELECT id FROM "User" WHERE email = $1`, [email("b")])).rows[0].id);
  check("B cannot delete A by naming A's email (the confirmation must be B's own)", (await B("DELETE", "/api/account", { json: { confirm: email("a") } })).status === 400);
  check("A still exists", (await A("GET", "/api/account")).status === 200);
  check("a userId in the query string changes nothing", (await B("GET", `/api/account?userId=${row.id}`)).data?.email === email("b"));

  console.log("disabled account");
  await pg.query(`UPDATE "User" SET disabled = true WHERE email = $1`, [email("b")]);
  check("an existing session of a disabled account is refused (403)", (await B("GET", "/api/account")).status === 403);
  const Bnew = client();
  const bIn = await Bnew("POST", "/api/auth/sign-in/email", { json: { email: email("b"), password: PASSWORD } });
  check("a disabled account cannot sign in", bIn.status >= 400 && (await Bnew("GET", "/api/account")).status !== 200, String(bIn.status));
  await pg.query(`UPDATE "User" SET disabled = false WHERE email = $1`, [email("b")]);

  console.log("account deletion (rows and files)");
  await A("POST", "/api/account/avatar", { body: PNG, headers: { "content-type": "image/png" } });
  check("a wrong confirmation is refused", (await A("DELETE", "/api/account", { json: { confirm: "someone-else@example.test" } })).status === 400);
  check("a missing confirmation is refused", (await A("DELETE", "/api/account", { json: {} })).status === 400);
  await pg.query(`INSERT INTO "SyncCursor" ("userId", revision, bytes, "updatedAt") VALUES ($1, 1, 5, now())`, [row.id]);
  await pg.query(`INSERT INTO "SyncDoc" ("userId", collection, id, data, revision, bytes) VALUES ($1, 'expense', 'live1', '{"amount":5}', 1, 12)`, [row.id]);
  const del = await A("DELETE", "/api/account", { json: { confirm: email("a").toUpperCase() } });
  check("the typed email (any case) deletes the account", del.status === 200 && del.data.deleted === true, JSON.stringify(del.data));
  check("its files were removed from Cloudinary", del.data?.cleanup === "done" && del.data?.filesRemoved >= 1, JSON.stringify(del.data));
  const left = [];
  for (const q of [`SELECT count(*)::int AS n FROM "User" WHERE id = $1`, `SELECT count(*)::int AS n FROM "Session" WHERE "userId" = $1`, `SELECT count(*)::int AS n FROM "Account" WHERE "userId" = $1`, `SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1`, `SELECT count(*)::int AS n FROM "SyncCursor" WHERE "userId" = $1`]) left.push((await pg.query(q, [row.id])).rows[0].n);
  check("no user, session, sign-in method, sync record or cursor is left", left.every((n) => n === 0), left.join(","));
  cloudinary.config({ ...cldConfig(), secure: true });
  const remaining = await cloudinary.api.resources({ type: "upload", prefix: `${FOLDER}/u/${row.id}`, resource_type: "image" });
  check("Cloudinary holds nothing under that user", remaining.resources.length === 0, String(remaining.resources.length));
  check("the deleted account's cookie no longer works", (await A("GET", "/api/account")).status === 401);
  check("B is untouched", (await B("GET", "/api/account")).status === 200);

  console.log("rate limit (stored in the database)");
  const R = client();
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await R("POST", "/api/auth/sign-in/email", { json: { email: email("nobody"), password: "Wrong-password-123" } })).status);
  check("repeated sign-in attempts are slowed down (429)", codes.includes(429), codes.join(","));
  const rl = (await pg.query(`SELECT count(*)::int AS n FROM "RateLimit"`)).rows[0].n;
  check("the counters are in the database", rl > 0, String(rl));
  await pg.query(`DELETE FROM "RateLimit"`);

  console.log("super admin seed script");
  const adminEmail = email("admin");
  check("a short seed password is refused before any database call", await seedSuperAdmin(pg, adminEmail, "short").then(() => false, (e) => e.code === "PASSWORD_SHORT"));
  check("the seed creates a super admin", (await seedSuperAdmin(pg, adminEmail, PASSWORD)) === "created");
  check("and running it again repairs it", (await seedSuperAdmin(pg, adminEmail, PASSWORD)) === "updated");
  const S = client();
  const sIn = await S("POST", "/api/auth/sign-in/email", { json: { email: adminEmail, password: PASSWORD } });
  check("the seeded account signs in with the library's own password check", sIn.status === 200, String(sIn.status));
  const sMe = await S("GET", "/api/account");
  check("its role is superadmin", sMe.data?.role === "superadmin", sMe.data?.role);
  created.push(sMe.data?.id);
  const others = (await pg.query(`SELECT count(*)::int AS n FROM "User" WHERE role = 'superadmin' AND disabled = false AND email <> $1`, [adminEmail])).rows[0].n;
  if (others === 0) check("the only super admin cannot delete themself (409)", (await S("DELETE", "/api/account", { json: { confirm: adminEmail } })).status === 409);
  const serverLog = log;
  check("the server log holds no password, no email address and no secret", !serverLog.includes(PASSWORD) && !serverLog.includes(env.BETTER_AUTH_SECRET) && !serverLog.includes("@example.test"));
} catch (e) {
  failures++;
  console.log(`account: stopped (${e?.message ?? e})`);
  console.log(log.split("\n").slice(-8).join("\n"));
} finally {
  server.kill();
  await cleanup();
  await pg.end().catch(() => undefined);
}
console.log(failures === 0 ? "\naccount: all checks passed, test data removed." : `\naccount: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
