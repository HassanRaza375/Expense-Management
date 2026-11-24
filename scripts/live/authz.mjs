// Real-service authorization check for Phase 8, run BY HAND (needs `npm run build` first): `node scripts/live/authz.mjs`.
// Starts the built server (sync flag ON) on a spare port against the TEST database and runs EVERY route in scripts/live/authzTable.mjs (the table must list every file in
// server/api/**) as: signed out, an ordinary user, a user who forged a role at sign-up, a user sending invented identity headers / query / body fields, a request from another
// origin, and the super admin. Then the size limits and the rate limit. No file is ever stored in Cloudinary (the clean-up route only lists the folder of a new account). Everything it creates is removed.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedSuperAdmin } from "../lib/seedSuperAdmin.mjs";
import { FORGED_HEADERS, ROUTES } from "./authzTable.mjs";
import { connect, resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`authz: REFUSED. ${target.error}`);
  process.exit(1);
}
const PORT = "3038";
const BASE = `http://localhost:${PORT}`;
const RUN = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
const email = (n) => `live-${RUN}-${n}@example.test`;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

const env = { ...process.env, PORT, NITRO_PORT: PORT, NUXT_PUBLIC_SYNC_ENABLED: "1", DATABASE_URL: target.url, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"), BETTER_AUTH_URL: BASE, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "", EMAIL_FROM: "", CLOUDINARY_FOLDER: "hisaab-test" }; // the real Cloudinary settings stay: the receipt routes need them, but no file is ever stored (the one listing is read-only)
const server = spawn(process.execPath, [".output/server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let ip = 100;
function browser() {
  const jar = new Map();
  const addr = `10.60.90.${ip++}`;
  const fn = async (method, url, { json, body, headers = {}, origin = BASE } = {}) => {
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
    return { status: res.status, data, text, headers: res.headers };
  };
  fn.jar = jar;
  fn.addr = addr;
  return fn;
}

/** A request with a body sent in chunks and NO content-length, so a size limit that only reads the header is caught. */
function chunked(cli, method, url, size, type = "application/json", extra = {}) {
  return new Promise((resolve, reject) => {
    const cookie = [...cli.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const req = http.request(BASE + url, { method, headers: { "x-forwarded-for": cli.addr, origin: BASE, "content-type": type, "transfer-encoding": "chunked", ...extra, ...(cookie ? { cookie } : {}) } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    const chunk = Buffer.alloc(1024, type === "application/json" ? 0x20 : 0x41); // spaces keep a JSON body valid
    for (let n = 0; n < size; n += chunk.length) req.write(chunk);
    req.end();
  });
}

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

const pg = await connect(target.url);
try {
  console.log("the table lists every route file");
  const apiDir = path.join(root, "server/api");
  const files = walk(apiDir).map((f) => path.relative(apiDir, f).replace(/\\/g, "/")).sort();
  const listed = ROUTES.map((r) => r.file).sort();
  check("every file in server/api is in the table, and every row is a file", JSON.stringify(files) === JSON.stringify(listed), JSON.stringify({ missing: files.filter((f) => !listed.includes(f)), stale: listed.filter((f) => !files.includes(f)) }));

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
  }
  check("the server starts", up);
  if (!up) throw new Error("server did not start");

  const A = browser();
  const B = browser();
  const C = browser(); // asks for a role at sign-up
  const D = browser(); // for the rate limit
  const ADM = browser();
  const NOBODY = browser();
  await A("POST", "/api/auth/sign-up/email", { json: { name: "A", email: email("a"), password: PASSWORD } });
  await B("POST", "/api/auth/sign-up/email", { json: { name: "B", email: email("b"), password: PASSWORD } });
  await C("POST", "/api/auth/sign-up/email", { json: { name: "C", email: email("c"), password: PASSWORD, role: "superadmin" } });
  await D("POST", "/api/auth/sign-up/email", { json: { name: "D", email: email("d"), password: PASSWORD } });
  await seedSuperAdmin(pg, email("admin"), PASSWORD);
  await ADM("POST", "/api/auth/sign-in/email", { json: { email: email("admin"), password: PASSWORD } });
  const idA = (await A("GET", "/api/account")).data.id;
  const idB = (await B("GET", "/api/account")).data.id;
  const idC = (await C("GET", "/api/account")).data.id;
  const idD = (await D("GET", "/api/account")).data.id;
  const idAdm = (await ADM("GET", "/api/account")).data.id;
  check("five accounts are signed in", [idA, idB, idC, idD, idAdm].every((x) => typeof x === "string" && x.length > 5));

  const H = (id) => ({ "x-hisaab-schema": "3", "x-hisaab-account": id });
  const exp = (id) => ({ collection: "expense", id, base: 0, put: { id, date: "2026-11-20T07:00:00.000Z", amount: 5, categoryId: "c" }, dayKey: "2026-11-20" });
  await A("POST", "/api/sync/push", { json: { ops: [exp("a1"), { collection: "receipt", id: "ra", base: 0, put: { id: "ra", expenseId: "a1", filename: "r", mimeType: "image/png", size: 10 }, dayKey: null }] }, headers: H(idA) });
  await B("POST", "/api/sync/push", { json: { ops: [exp("b1")] }, headers: H(idB) });

  const send = (cli, row, extra = {}) => {
    const p = row.path.replace("{victim}", row.access === "admin" ? idB : "ra");
    const opts = { ...extra };
    if (row.body !== undefined && !row.raw) opts.json = row.body;
    if (row.sync) opts.headers = { ...H(cli === A ? idA : idAdm), ...(extra.headers ?? {}) };
    return cli(row.method, p, opts);
  };

  console.log("signed out");
  for (const row of ROUTES) {
    const r = await send(NOBODY, row);
    const want = row.access === "public" ? (row.publicStatus ?? 200) : row.access === "admin" ? 404 : 401;
    check(`${row.method} ${row.path.replace("{victim}", "<id>")} -> ${want}`, r.status === want, String(r.status));
  }

  console.log("an ordinary user, a user who forged a role at sign-up, and a user sending invented identity headers");
  check("the forged role at sign-up did not take", (await pg.query(`SELECT role FROM "User" WHERE id = $1`, [idC])).rows[0].role === "user");
  for (const row of ROUTES.filter((r) => r.access === "admin")) {
    const out = [(await send(A, row)).status, (await send(C, row)).status, (await send(A, row, { headers: FORGED_HEADERS(idAdm) })).status];
    const q = await A(row.method, `${row.path.replace("{victim}", idB)}?userId=${idAdm}&role=superadmin&admin=true`, row.body ? { json: row.body } : {});
    out.push(q.status);
    check(`${row.method} ${row.path.replace("{victim}", "<id>")}: an ordinary user, the forged-role user, invented headers and query fields all get 404`, out.every((s) => s === 404), out.join(","));
  }
  const bBefore = (await pg.query(`SELECT role, name, disabled FROM "User" WHERE id = $1`, [idB])).rows[0];
  await A("PATCH", `/api/admin/users/${idB}`, { json: { role: "superadmin", disabled: true, name: "pwned" }, headers: FORGED_HEADERS(idAdm) });
  await A("DELETE", `/api/admin/users/${idB}`, { json: { confirm: email("b") } });
  const bAfter = (await pg.query(`SELECT role, name, disabled FROM "User" WHERE id = $1`, [idB])).rows[0];
  check("none of that changed or deleted anyone", JSON.stringify(bBefore) === JSON.stringify(bAfter));
  check("the super admin is let in to the same routes", (await Promise.all(ROUTES.filter((r) => r.access === "admin" && r.method === "GET").map((r) => send(ADM, r)))).every((r) => r.status === 200));

  for (const row of ROUTES.filter((r) => r.access === "user")) {
    const r = await send(A, row, { headers: { ...FORGED_HEADERS(idB), ...(row.sync ? H(idA) : {}) } });
    check(`${row.method} ${row.path.replace("{victim}", "<id>")}: a signed-in account is not refused as signed out, and nothing fails (got ${r.status})`, r.status !== 401 && r.status < 500);
  }

  console.log("the account acted on is always the session's");
  const me = await A("GET", `/api/account?userId=${idB}&id=${idB}`, { headers: FORGED_HEADERS(idB) });
  check("GET /api/account with invented headers and fields still answers for the session's account", me.status === 200 && me.data.id === idA && me.data.email === email("a"));
  const pullA = await A("POST", "/api/sync/pull", { json: { since: 0, userId: idB, account: idB }, headers: { ...H(idA), ...FORGED_HEADERS(idB) } });
  const idsA = (pullA.data?.changes ?? pullA.data?.records ?? []).map((x) => x.id);
  check("a pull that names another account's id in the body returns only the session's records", pullA.status === 200 && idsA.includes("a1") && !idsA.includes("b1"), JSON.stringify(idsA));
  check("a pull with another account's id in the account header is 409 account_mismatch", (await A("POST", "/api/sync/pull", { json: { since: 0 }, headers: H(idB) })).status === 409);
  check("a push with another account's id in the account header is 409", (await A("POST", "/api/sync/push", { json: { ops: [exp("a-evil")] }, headers: H(idB) })).status === 409);
  check("the summary with another account's id is 409", (await A("GET", "/api/sync/summary", { headers: H(idB) })).status === 409);
  check("no account header at all is 409", (await A("POST", "/api/sync/pull", { json: { since: 0 }, headers: { "x-hisaab-schema": "3" } })).status === 409);
  check("a wrong data version is 409", (await A("POST", "/api/sync/pull", { json: { since: 0 }, headers: { "x-hisaab-schema": "2", "x-hisaab-account": idA } })).status === 409);
  const pushEvil = await A("POST", "/api/sync/push", { json: { userId: idB, ops: [{ ...exp("a2"), userId: idB }] }, headers: H(idA) });
  const bRows = (await pg.query(`SELECT id FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'expense' ORDER BY id`, [idB])).rows.map((r) => r.id);
  const aRows = (await pg.query(`SELECT id FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'expense' ORDER BY id`, [idA])).rows.map((r) => r.id);
  const wrote = pushEvil.status === 200 && (pushEvil.data?.results ?? []).every((r) => r.status !== "rejected");
  check("a push that names another account in an extra field never touches that account (it is refused, or it writes to the session's own account only)", JSON.stringify(bRows) === JSON.stringify(["b1"]) && (wrote ? aRows.includes("a2") : !aRows.includes("a2")), JSON.stringify({ status: pushEvil.status, aRows, bRows }));
  check("a cookie that was tampered with is signed out", await (async () => {
    const t = browser();
    t.jar.set([...A.jar.keys()][0], [...A.jar.values()][0].slice(0, -3) + "AAA");
    return (await t("GET", "/api/account")).status === 401;
  })());

  console.log("one account cannot reach another's receipt, or delete another account");
  check("B cannot get a link to A's receipt record (404)", (await B("GET", "/api/receipts/ra")).status === 404);
  check("B cannot upload over A's receipt record (404)", (await B("PUT", "/api/receipts/ra", { body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), headers: { "content-type": "image/png" } })).status === 404);
  const wrongDel = await A("DELETE", "/api/account", { json: { confirm: email("b") } });
  check("A cannot delete an account by typing another account's email (4xx)", wrongDel.status >= 400 && wrongDel.status < 500 && (await pg.query(`SELECT 1 FROM "User" WHERE id IN ($1, $2)`, [idA, idB])).rows.length === 2, String(wrongDel.status));

  console.log("a request from another origin is refused (CSRF)");
  for (const row of ROUTES.filter((r) => r.access === "user" && r.method !== "GET")) {
    const r = await send(A, row, { origin: "https://evil.example" });
    check(`${row.method} ${row.path.replace("{victim}", "<id>")} from another origin -> 403`, r.status === 403, String(r.status));
  }
  for (const row of ROUTES.filter((r) => r.access === "admin" && r.method !== "GET")) {
    const asAdmin = await send(ADM, row, { origin: "https://evil.example" });
    const asUser = await send(A, row, { origin: "https://evil.example" });
    check(`${row.method} ${row.path.replace("{victim}", "<id>")} from another origin: 403 for the super admin, still 404 for anyone else`, asAdmin.status === 403 && asUser.status === 404, `${asAdmin.status} ${asUser.status}`);
  }

  console.log("size limits (bodies sent with no content-length are measured too)");
  check("a push body over 1 MB is 413", (await A("POST", "/api/sync/push", { body: JSON.stringify({ ops: [], pad: "x".repeat(1024 * 1024 + 10) }), headers: { ...H(idA), "content-type": "application/json" } })).status === 413);
  check("a chunked push body over 1 MB is 413", await chunked(A, "POST", "/api/sync/push", 1024 * 1024 + 4096, "application/json", H(idA)).then((st) => (console.log(`  (chunked push status ${st})`), st === 413)));
  check("a push of 201 operations is refused (4xx)", await (async () => {
    const ops = Array.from({ length: 201 }, (_, i) => exp(`many${i}`));
    const r = await A("POST", "/api/sync/push", { json: { ops }, headers: H(idA) });
    return r.status >= 400 && r.status < 500;
  })());
  check("a pull body over 1 KB is 413", (await A("POST", "/api/sync/pull", { body: JSON.stringify({ since: 0, pad: "x".repeat(2000) }), headers: { ...H(idA), "content-type": "application/json" } })).status === 413);
  check("a chunked account-delete body over 4 KB is 413", (await chunked(A, "DELETE", "/api/account", 8192)) === 413);
  check("a chunked admin edit body over 4 KB is 413", (await chunked(ADM, "PATCH", `/api/admin/users/${idB}`, 8192)) === 413);
  check("a profile photo over 512 KB is 413", (await A("POST", "/api/account/avatar", { body: Buffer.alloc(600 * 1024, 1), headers: { "content-type": "image/jpeg" } })).status === 413);
  check("a receipt over 10 MB is 413", (await A("PUT", "/api/receipts/ra", { body: Buffer.alloc(10 * 1024 * 1024 + 1, 1), headers: { "content-type": "image/png" } })).status === 413);
  check("an admin query with unknown fields and a very long search does not fail (the search is cut, unknown fields are ignored)", (await ADM("GET", `/api/admin/users?search=${"a".repeat(5000)}&evil=1&page=-3`)).status < 500);

  console.log("the rate limit: one account's budget, a 429 with Retry-After, and it recovers");
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await D("POST", "/api/receipts/cleanup", { json: {} })).status);
  console.log(`  cleanup x7 as one account: ${statuses.join(",")}`);
  check("six clean-ups in a minute are allowed, the seventh is 429", statuses.slice(0, 6).every((s) => s === 200) && statuses[6] === 429, statuses.join(","));
  const blocked = await D("POST", "/api/receipts/cleanup", { json: {} });
  const retry = Number(blocked.headers.get("retry-after"));
  check("the 429 is JSON, says rate_limited and carries Retry-After (at most 60 s)", blocked.status === 429 && blocked.data?.error === "rate_limited" && retry >= 1 && retry <= 60, `${blocked.status} ${JSON.stringify(blocked.data)} ${retry}`);
  check("the same account can still use its other routes", (await D("GET", "/api/account")).status === 200);
  check("another account is not affected", (await B("POST", "/api/receipts/cleanup", { json: {} })).status === 200);
  await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
  check("after the window it works again", (await D("POST", "/api/receipts/cleanup", { json: {} })).status === 200);
  const rows = await pg.query(`SELECT count(*)::int AS n FROM "RateLimit" WHERE key LIKE 'api:%' || $1`, [idD]);
  check("its counter is a row in the database, keyed by the account (never an address)", rows.rows[0].n >= 1);
  const gone = await D("DELETE", "/api/account", { json: { confirm: email("d") } });
  check("deleting the account removes its counters", gone.status === 200 && (await pg.query(`SELECT count(*)::int AS n FROM "RateLimit" WHERE key LIKE 'api:%' || $1`, [idD])).rows[0].n === 0, JSON.stringify(gone.data));
  check("the server log holds no password, no address and no cookie", !log.includes(PASSWORD) && !log.includes("@example.test") && !/better-auth\.session_token/.test(log));
} catch (e) {
  failures++;
  console.log(`authz: stopped (${String(e?.message ?? e).split("\n")[0]})`);
  console.log(log.split("\n").slice(-6).join("\n"));
} finally {
  server.kill();
  try {
    await pg.query(`DELETE FROM "AuditLog" WHERE "actorEmail" LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
  } catch (e) {
    console.log(`authz: clean-up problem (${e?.code ?? "error"})`);
  }
  await pg.end().catch(() => undefined);
}
console.log(failures === 0 ? "\nauthz: all checks passed, test data removed." : `\nauthz: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
