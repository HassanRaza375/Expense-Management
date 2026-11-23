// Real-service check for Phase 7, run BY HAND (needs `npm run build` first): `node scripts/live/admin.mjs`.
// Starts the built server (sync flag ON) on a spare port against the TEST database and REAL Cloudinary (folder `hisaab-test`), creates a super admin the way the seed script does
// and two ordinary users, and walks the admin panel over HTTP: a signed-out visitor, an ordinary user and a user who forged a role in the sign-up all get 404 on every admin
// route; the admin's numbers equal the numbers worked out here from the same records (including the month boundary); the admin never sees notes or receipts; every write is
// audited; the self and disabled-account rules hold; and deleting a user removes the rows and the files. Everything it creates is removed.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";
import { seedSuperAdmin } from "../lib/seedSuperAdmin.mjs";
import { connect, resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`admin: REFUSED. ${target.error}`);
  process.exit(1);
}
const PORT = "3037";
const BASE = `http://localhost:${PORT}`;
const FOLDER = "hisaab-test";
const RUN = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
const email = (n) => `live-${RUN}-${n}@example.test`;
const SECRET_NOTE = `SECRET-NOTE-${RUN}`;
const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL ?? "");
const cld = m ? { api_key: m[1], api_secret: m[2], cloud_name: m[3], secure: true } : null;
if (!cld) {
  console.log("admin: CLOUDINARY_URL is not set; nothing was checked.");
  process.exit(1);
}
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const env = { ...process.env, PORT, NITRO_PORT: PORT, NUXT_PUBLIC_SYNC_ENABLED: "1", DATABASE_URL: target.url, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"), BETTER_AUTH_URL: BASE, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "", EMAIL_FROM: "", CLOUDINARY_FOLDER: FOLDER };
const server = spawn(process.execPath, [".output/server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let ip = 80;
function browser() {
  const jar = new Map();
  const addr = `10.60.80.${ip++}`;
  return async (method, url, { json, body, headers = {}, origin = BASE } = {}) => {
    const h = { "x-forwarded-for": addr, ...headers };
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
      if (pair.slice(i + 1) === "" || /max-age=0/i.test(c)) jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, text };
  };
}

const pg = await connect(target.url);
const created = [];
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
  }
  check("the server starts", up);
  if (!up) throw new Error("server did not start");

  // ---- the people ---------------------------------------------------------------------------------------------------------------------------------------------
  const A = browser(); // an ordinary user with data
  const B = browser(); // an ordinary user who tries to forge a role
  const ADM = browser(); // the super admin
  const NOBODY = browser(); // signed out
  await A("POST", "/api/auth/sign-up/email", { json: { name: "Ann", email: email("a"), password: PASSWORD } });
  const forged = await B("POST", "/api/auth/sign-up/email", { json: { name: "Bob", email: email("b"), password: PASSWORD, role: "superadmin", disabled: false } });
  const idA = (await A("GET", "/api/account")).data.id;
  const idB = (await B("GET", "/api/account")).data.id;
  created.push(idA, idB);
  console.log(`a sign-up that asks for role=superadmin: HTTP ${forged.status}`);
  check("the forged role did not take: the user is an ordinary user", (await pg.query(`SELECT role FROM "User" WHERE id = $1`, [idB])).rows[0].role === "user");
  const seeded = await seedSuperAdmin(pg, email("admin"), PASSWORD);
  check("the super admin is created the way the seed script does", seeded === "created");
  const admRow = (await pg.query(`SELECT id FROM "User" WHERE email = $1`, [email("admin")])).rows[0];
  created.push(admRow.id);
  const login = await ADM("POST", "/api/auth/sign-in/email", { json: { email: email("admin"), password: PASSWORD } });
  check("the super admin signs in", login.status === 200, String(login.status));

  const ROUTES = [["GET", "/api/admin/overview"], ["GET", "/api/admin/users"], [`GET`, `/api/admin/users/${idA}`], ["GET", "/api/admin/expenses"], ["GET", "/api/admin/income"], ["GET", "/api/admin/investments"], ["GET", "/api/admin/storage"], ["GET", "/api/admin/audit"], ["PATCH", `/api/admin/users/${idA}`, { name: "x" }], ["DELETE", `/api/admin/users/${idA}`, { confirm: email("a") }], ["POST", `/api/admin/users/${idA}/reset-email`, {}]];

  console.log("who is turned away");
  for (const [c, label] of [[NOBODY, "a signed-out visitor"], [A, "an ordinary user"], [B, "a user who tried to forge a role"]]) {
    const out = [];
    for (const [method, url, json] of ROUTES) out.push((await c(method, url, json === undefined ? {} : { json })).status);
    check(`${label} gets 404 on every admin route (${ROUTES.length})`, out.every((s) => s === 404), out.join(","));
  }
  const same = await A("GET", "/api/admin/overview");
  const unknown = await A("GET", "/api/admin/no-such-thing");
  check("the answer is a plain 404, the same status as for an address that does not exist", same.status === 404 && unknown.status === 404 && JSON.stringify(same.data) === JSON.stringify({ error: "not_found" }), `${same.status} ${unknown.status}`);
  check("the role of an ordinary user never changed by asking", (await pg.query(`SELECT role FROM "User" WHERE id = ANY($1)`, [[idA, idB]])).rows.every((r) => r.role === "user"));
  const after = await B("POST", "/api/auth/update-user", { json: { name: "Bob", role: "superadmin" } });
  console.log(`an update-user that asks for role=superadmin: HTTP ${after.status}`);
  check("still not an admin after trying to change the role on the account", (await pg.query(`SELECT role FROM "User" WHERE id = $1`, [idB])).rows[0].role === "user" && (await B("GET", "/api/admin/overview")).status === 404);
  check("a write from another origin is refused even for the super admin (403)", (await ADM("PATCH", `/api/admin/users/${idA}`, { json: { name: "forged" }, origin: "https://evil.example" })).status === 403 && (await pg.query(`SELECT name FROM "User" WHERE id = $1`, [idA])).rows[0].name === "Ann");
  check("the admin gets 200 on the overview", (await ADM("GET", "/api/admin/overview")).status === 200);

  // ---- the numbers ---------------------------------------------------------------------------------------------------------------------------------------------
  console.log("the numbers equal the user's own records (computed here, in minor units, from the same records)");
  const H = (id) => ({ "x-hisaab-schema": "3", "x-hisaab-account": id });
  const push = (c, id, ops) => c("POST", "/api/sync/push", { json: { ops }, headers: H(id) });
  // the month boundary: 31 Oct 23:30 and 1 Nov 00:30 LOCAL (the client says which day each is; the server never works it out)
  const ex = (id, day, amount, kind, note) => ({ collection: "expense", id, base: 0, put: { id, date: `${day}T12:00:00.000Z`, amount, categoryId: "cat-food", note, ...(kind ? { kind } : {}) }, dayKey: day });
  const pushed = await push(A, idA, [
    ex("x1", "2026-10-31", 12.34, undefined, SECRET_NOTE),
    ex("x2", "2026-11-01", 100.5, undefined, SECRET_NOTE),
    ex("x3", "2026-11-02", 20, undefined, SECRET_NOTE),
    ex("x4", "2026-11-02", 5.25, "refund", SECRET_NOTE),
    { collection: "income", id: "i1", base: 0, put: { id: "i1", date: "2026-11-03T12:00:00.000Z", amount: 5000, sourceType: "salary", note: SECRET_NOTE }, dayKey: "2026-11-03" },
    { collection: "receipt", id: "rc1", base: 0, put: { id: "rc1", expenseId: "x2", filename: SECRET_NOTE, mimeType: "image/png", size: PNG.length }, dayKey: null },
  ]);
  const results = pushed.data?.results ?? [];
  check("all six records reach the account", pushed.status === 200 && results.length === 6 && results.every((r) => r.status !== "rejected"), JSON.stringify(pushed.data).slice(0, 200));
  const stored = await A("PUT", "/api/receipts/rc1", { body: PNG, headers: { "content-type": "image/png" } });
  check("a receipt file is stored for the user", stored.status === 200, JSON.stringify(stored.data));
  const exp = (await ADM("GET", `/api/admin/expenses?userId=${idA}`)).data;
  const oct = exp.byMonth.find((x) => x.month === "2026-10");
  const nov = exp.byMonth.find((x) => x.month === "2026-11");
  check("October holds the 31st (1,234)", oct?.gross === 1234 && oct?.net === 1234 && oct?.count === 1, JSON.stringify(oct));
  check("November holds the 1st to the 2nd: spent 12,050, refunds 525, net 11,525", nov?.gross === 12050 && nov?.refunds === 525 && nov?.net === 11525 && nov?.count === 3, JSON.stringify(nov));
  check("the total is 12,759", exp.total === 12759, String(exp.total));
  const inc = (await ADM("GET", `/api/admin/income?userId=${idA}`)).data;
  const nI = inc.byMonth.find((x) => x.month === "2026-11");
  check("income 500,000 and the cash flow is income minus expenses' net", nI?.income === 500000 && nI?.expenses === 11525 && nI?.net === 500000 - 11525, JSON.stringify(nI));
  const det = await ADM("GET", `/api/admin/users/${idA}`);
  check("the user detail agrees with the same numbers", det.status === 200 && det.data.expenses.total === 12759 && det.data.storage.receipts === 1 && det.data.storage.receiptBytes === PNG.length, JSON.stringify(det.data?.storage));
  const stor = (await ADM("GET", "/api/admin/storage")).data;
  check("the storage page counts the receipt and its bytes, per user", stor.perUser.find((u) => u.userId === idA)?.receipts === 1 && stor.perUser.find((u) => u.userId === idA)?.receiptBytes === PNG.length);

  console.log("what the admin never sees");
  const everything = [];
  for (const [, url] of ROUTES.slice(0, 8)) everything.push((await ADM("GET", url)).text);
  everything.push((await ADM("GET", `/api/admin/expenses?userId=${idA}`)).text, (await ADM("GET", `/api/admin/income?userId=${idA}`)).text);
  const all = everything.join("\n");
  check("no note or receipt name appears in any admin response", !all.includes(SECRET_NOTE));
  check("no password, hash, token, avatar or vault content appears", !/password|\$argon|scrypt|salt|sessionToken|"token"|avatar|vault|ciphertext/i.test(all));

  // ---- the writes ----------------------------------------------------------------------------------------------------------------------------------------------
  console.log("every write is audited, and the guards hold");
  const patch = (id, json) => ADM("PATCH", `/api/admin/users/${id}`, { json });
  check("rename a user", (await patch(idA, { name: "Ann Lee" })).status === 200 && (await pg.query(`SELECT name FROM "User" WHERE id = $1`, [idA])).rows[0].name === "Ann Lee");
  check("an email that is taken is refused (409)", (await patch(idA, { email: email("b") })).status === 409);
  check("a role that does not exist is refused (400)", (await patch(idA, { role: "god" })).status === 400);
  check("a no-change save records nothing", (await patch(idA, { name: "Ann Lee" })).status === 200);
  check("an ordinary user's own session still works", (await A("GET", "/api/account")).status === 200);
  check("disable a user: signed out at once, and cannot sign in", (await patch(idA, { disabled: true })).status === 200 && (await A("GET", "/api/account")).status === 401 && (await browser()("POST", "/api/auth/sign-in/email", { json: { email: email("a"), password: PASSWORD } })).status >= 400);
  check("enable again: can sign in", (await patch(idA, { disabled: false })).status === 200 && (await browser()("POST", "/api/auth/sign-in/email", { json: { email: email("a"), password: PASSWORD } })).status === 200);
  check("promote B, and B now sees the panel", (await patch(idB, { role: "superadmin" })).status === 200 && (await B("GET", "/api/admin/overview")).status === 200);
  check("demote B again, and B is turned away", (await patch(idB, { role: "user" })).status === 200 && (await B("GET", "/api/admin/overview")).status === 404);
  check("the admin cannot demote, disable or delete themself (409)", (await patch(admRow.id, { role: "user" })).status === 409 && (await patch(admRow.id, { disabled: true })).status === 409 && (await ADM("DELETE", `/api/admin/users/${admRow.id}`, { json: { confirm: email("admin") } })).status === 409);
  check("sending a reset email says honestly that email is not set up (503)", (await ADM("POST", `/api/admin/users/${idB}/reset-email`, { json: {} })).status === 503);
  const audit = (await ADM("GET", "/api/admin/audit")).data;
  const mine = audit.entries.filter((e) => e.actorEmail === email("admin")).map((e) => e.action).sort();
  check("the audit log holds exactly the real changes, with the actor", JSON.stringify(mine) === JSON.stringify(["user.disable", "user.enable", "user.role", "user.role", "user.update"]), mine.join(","));
  const auditText = JSON.stringify(audit);
  check("the audit log holds no password, hash or note", !/password|\$argon|scrypt/i.test(auditText) && !auditText.includes(SECRET_NOTE));

  console.log("deleting a user removes the rows and the files");
  cloudinary.config(cld);
  const before = (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}` })).resources.length;
  check("the user's receipt file is in Cloudinary first", before === 1, String(before));
  const wrong = await ADM("DELETE", `/api/admin/users/${idA}`, { json: { confirm: "someone@else.test" } });
  check("a wrong typed email is refused (4xx)", wrong.status >= 400 && wrong.status < 500, String(wrong.status));
  check("nothing was deleted by the refusal", (await pg.query(`SELECT 1 FROM "User" WHERE id = $1`, [idA])).rows.length === 1);
  const del = await ADM("DELETE", `/api/admin/users/${idA}`, { json: { confirm: email("a") } });
  check("with the typed email the user is deleted", del.status === 200, JSON.stringify(del.data));
  const left = await pg.query(`SELECT (SELECT count(*) FROM "User" WHERE id = $1) AS u, (SELECT count(*) FROM "SyncDoc" WHERE "userId" = $1) AS d, (SELECT count(*) FROM "SyncCursor" WHERE "userId" = $1) AS c, (SELECT count(*) FROM "Session" WHERE "userId" = $1) AS s`, [idA]);
  check("no user, record, cursor or session rows are left", Object.values(left.rows[0]).every((v) => Number(v) === 0), JSON.stringify(left.rows[0]));
  check("the user's files are gone from Cloudinary", (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}` })).resources.length === 0);
  const delAudit = await pg.query(`SELECT action FROM "AuditLog" WHERE "targetId" = $1 AND action = 'user.delete'`, [idA]);
  check("the deletion is in the audit log (which outlives the user)", delAudit.rows.length === 1);
  check("a deleted user is a 404 on the admin pages", (await ADM("GET", `/api/admin/users/${idA}`)).status === 404);
  check("the server log holds no password, no address and no note", !log.includes(PASSWORD) && !log.includes("@example.test") && !log.includes(SECRET_NOTE));
} catch (e) {
  failures++;
  console.log(`admin: stopped (${String(e?.message ?? e).split("\n")[0]})`);
  console.log(log.split("\n").slice(-6).join("\n"));
} finally {
  server.kill();
  try {
    await pg.query(`DELETE FROM "AuditLog" WHERE "actorEmail" LIKE $1 OR "targetId" = ANY($2)`, [`live-${RUN}-%@example.test`, created.length ? created : [""]]);
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
    cloudinary.config(cld);
    for (const id of created) {
      for (const type of ["upload", "authenticated"]) await cloudinary.api.delete_resources_by_prefix(`${FOLDER}/u/${id}`, { type }).catch(() => undefined);
      await cloudinary.api.delete_folder(`${FOLDER}/u/${id}`).catch(() => undefined);
    }
  } catch (e) {
    console.log(`admin: clean-up problem (${e?.code ?? "error"})`);
  }
  await pg.end().catch(() => undefined);
}
console.log(failures === 0 ? "\nadmin: all checks passed, test data removed." : `\nadmin: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
