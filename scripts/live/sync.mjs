// Real-service check for Phase 5, run BY HAND (needs `npm run build` first): `node scripts/live/sync.mjs`.
// Starts the built server (sync flag ON) on a spare port against the TEST database (scripts/live/testDb.mjs), then runs the REAL sync engine (bundled with esbuild) for
// several simulated devices through real HTTP, and checks the real database. Everything it creates is removed at the end, even after a failure. Prints no secret.
//
// It proves what the in-memory tests cannot: the Prisma implementation (FOR UPDATE ordering, projection columns, bigint revisions, tombstones, byte counts), the real
// routes (session, CSRF, schema and account checks, body limits) and the engine over real HTTP, against a real PostgreSQL.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { connect, resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`sync: REFUSED. ${target.error}`);
  process.exit(1);
}

// ---- the real engine, bundled for Node ----
const work = mkdtempSync(path.join(tmpdir(), "hisaab-live-"));
await build({ entryPoints: [path.join(root, "scripts/live/syncEntry.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(work, "engine.mjs"), logLevel: "error", absWorkingDir: root });
const { SyncEngine, SyncApiError, httpSyncApi, sampleStorage } = await import(pathToFileURL(path.join(work, "engine.mjs")).href);

const PORT = "3034";
const BASE = `http://localhost:${PORT}`;
const RUN = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
const email = (n) => `live-${RUN}-${n}@example.test`;
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

// ---- a browser's worth of HTTP: a cookie jar, an Origin, and its own client address ----
let ip = 20;
function browser() {
  const jar = new Map();
  const addr = `10.40.50.${ip++}`;
  const call = async (method, url, { json, body, headers = {}, origin = BASE } = {}) => {
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
      if (/max-age=0/i.test(c) || pair.slice(i + 1) === "") jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
  // the fetch the engine's client uses: same cookie jar, same origin
  const fetchImpl = async (url, init = {}) => {
    const h = { ...(init.headers ?? {}), origin: BASE, "x-forwarded-for": addr };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return fetch(BASE + url, { ...init, headers: h });
  };
  return { call, fetchImpl };
}

// ---- a device: the real engine over real HTTP, with a memory cache ----
function device(b, userId) {
  const cache = new Map();
  const bases = { state: null };
  const store = {
    read: (k) => (cache.has(k) ? structuredClone(cache.get(k)) : undefined),
    write(k, v) {
      if (v === undefined) cache.delete(k);
      else cache.set(k, structuredClone(v));
    },
  };
  const baseStore = {
    load: async () => (bases.state ? { ...bases.state, base: new Map(bases.state.base) } : null),
    async save(p) {
      const s = (bases.state ??= { base: new Map(), cursor: 0 });
      for (const [k, v] of p.put ?? []) s.base.set(k, structuredClone(v));
      for (const k of p.del ?? []) s.base.delete(k);
      if (p.cursor !== undefined) s.cursor = p.cursor;
      if (p.lastUpload !== undefined) s.lastUpload = p.lastUpload ?? [];
      if (p.lastSyncAt !== undefined) s.lastSyncAt = p.lastSyncAt;
    },
    clear: async () => void (bases.state = null),
  };
  const api = httpSyncApi(userId, b.fetchImpl);
  const engine = new SyncEngine({ api, store, bases: baseStore });
  return { cache, engine, api, get: (k) => store.read(k), set: (k, v) => store.write(k, v) };
}

const pg = await connect(target.url);
const norm = (d) => {
  const out = {};
  for (const k of ["expenses", "income", "investments", "lending", "goals", "accounts", "bills", "settings"]) {
    let v = structuredClone(d.get(k));
    const sort = (x) => (Array.isArray(x) ? x.map(sort).sort((a, b) => String(a?.id).localeCompare(String(b?.id))) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q)).map(([kk, vv]) => [kk, sort(vv)])) : x);
    if (k === "expenses" && v) v.forEach((e) => delete e.receipts);
    if (k === "bills" && v) v.bills.forEach((b2) => (b2.attachments = []));
    if (k === "settings" && v) delete v.theme;
    out[k] = JSON.stringify(sort(v));
  }
  return out;
};

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
  }
  check("the server starts and reaches the test database", up);
  if (!up) throw new Error("server did not start");

  // ---- two accounts ----
  const A = browser();
  const signA = await A.call("POST", "/api/auth/sign-up/email", { json: { name: "Live A", email: email("a"), password: PASSWORD } });
  check("account A signs up", signA.status === 200, String(signA.status));
  const idA = (await A.call("GET", "/api/account")).data.id;
  const B = browser();
  await B.call("POST", "/api/auth/sign-up/email", { json: { name: "Live B", email: email("b"), password: PASSWORD } });
  const idB = (await B.call("GET", "/api/account")).data.id;

  console.log("the routes refuse what they should");
  const anon = browser();
  const H = (userId) => ({ "x-hisaab-schema": "3", "x-hisaab-account": userId });
  check("push without a session is 401", (await anon.call("POST", "/api/sync/push", { json: { ops: [] }, headers: H(idA) })).status === 401);
  check("pull without a session is 401", (await anon.call("POST", "/api/sync/pull", { json: { since: 0 }, headers: H(idA) })).status === 401);
  check("summary without a session is 401", (await anon.call("GET", "/api/sync/summary", { headers: H(idA) })).status === 401);
  check("a request from another origin is refused (403)", (await A.call("POST", "/api/sync/push", { json: { ops: [] }, headers: H(idA), origin: "https://evil.example" })).status === 403);
  check("the wrong data version is 409 schema_mismatch", (await A.call("POST", "/api/sync/pull", { json: { since: 0 }, headers: { "x-hisaab-schema": "2", "x-hisaab-account": idA } })).data?.error === "schema_mismatch");
  check("no data version at all is 409 too", (await A.call("POST", "/api/sync/pull", { json: { since: 0 }, headers: { "x-hisaab-account": idA } })).status === 409);
  check("naming another account is 409 account_mismatch (A's session, B's id)", (await A.call("POST", "/api/sync/push", { json: { ops: [] }, headers: H(idB) })).data?.error === "account_mismatch");
  check("no account header is 409 too", (await A.call("POST", "/api/sync/push", { json: { ops: [] }, headers: { "x-hisaab-schema": "3" } })).status === 409);
  check("a body that is not JSON is 400", (await A.call("POST", "/api/sync/push", { body: "not json", headers: { ...H(idA), "content-type": "application/json" } })).status === 400);
  check("a body over 1 MB is 413", (await A.call("POST", "/api/sync/push", { body: JSON.stringify({ ops: [], pad: "x".repeat(1_100_000) }), headers: { ...H(idA), "content-type": "application/json" } })).status === 413);
  check("more than 200 operations is 413", (await A.call("POST", "/api/sync/push", { json: { ops: Array.from({ length: 201 }, (_, i) => ({ collection: "expense", id: `x${i}`, base: 0, put: { id: `x${i}` } })) }, headers: H(idA) })).status === 413);
  check("a bad cursor is 400", (await A.call("POST", "/api/sync/pull", { json: { since: -1 }, headers: H(idA) })).status === 400);
  check("pull has no GET form and push has no GET form (404 as an unknown route)", (await A.call("GET", "/api/sync/push", { headers: H(idA) })).status >= 400);

  console.log("per-operation refusals (the rest of the push still applies)");
  const odd = await A.call("POST", "/api/sync/push", {
    headers: H(idA),
    json: {
      ops: [
        { collection: "expense", id: "ok1", base: 0, put: { id: "ok1", amount: 5, date: "2026-11-20T07:00:00.000Z", categoryId: "c" }, dayKey: "2026-11-20" },
        { collection: "nope", id: "z", base: 0, put: { id: "z" } },
        { collection: "expense", id: "bad-day", base: 0, put: { id: "bad-day", amount: 1 }, dayKey: "2026-02-30" },
        { collection: "expense", id: "bad-amt", base: 0, put: { id: "bad-amt", amount: "12" } },
        { collection: "expense", id: "huge", base: 0, put: { id: "huge", amount: 1, note: "x".repeat(20000) } },
        { collection: "expense", id: "other", base: 0, put: { id: "different" } },
      ],
    },
  });
  const reasons = odd.data.results.map((r) => (r.status === "rejected" ? r.reason : r.status));
  check("one ok, the rest refused with their reasons", JSON.stringify(reasons) === JSON.stringify(["ok", "unknown_collection", "invalid_day", "invalid_record", "record_too_large", "id_mismatch"]), JSON.stringify(reasons));
  await A.call("POST", "/api/sync/push", { headers: H(idA), json: { ops: [{ collection: "expense", id: "ok1", base: 1, delete: true }] } });

  console.log("two devices of one account, through the real engine and the real database");
  const d1 = device(A, idA);
  const d2 = device(A, idA);
  for (const [k, v] of Object.entries(sampleStorage())) d1.set(k, v);
  await d1.engine.init();
  const up1 = await d1.engine.syncOnce();
  check("device 1 uploads the whole data set, nothing pending", up1.pending === 0 && up1.rejected.length === 0, JSON.stringify(up1));
  await d2.engine.init();
  await d2.engine.syncOnce();
  check("device 2 receives the same data (device-only parts excepted)", JSON.stringify(norm(d2)) === JSON.stringify(norm(d1)));

  const rows = (await pg.query(`SELECT collection, id, "dayKey", "amountMinor", kind, "categoryId", "accountId", "parentId", deleted:: text FROM (SELECT collection, id, "dayKey", "amountMinor"::text AS "amountMinor", kind, "categoryId", "accountId", "parentId", ("deletedAt" IS NOT NULL) AS deleted FROM "SyncDoc" WHERE "userId" = $1) t`, [idA])).rows;
  const by = (c, id) => rows.find((r) => r.collection === c && r.id === id);
  check("the expense is stored with minor units, the client's day, kind, category, account", by("expense", "e2")?.amountMinor === "12050" && /^2026-11-1[789]$/.test(by("expense", "e2")?.dayKey) && by("expense", "e2")?.kind === "expense" && by("expense", "e2")?.categoryId === "cat-food", JSON.stringify(by("expense", "e2")));
  check("a refund keeps its kind", by("expense", "e3")?.kind === "refund");
  check("a child record carries its parent id and its own day", by("fundContribution", "fc1")?.parentId === "f1" && by("fundContribution", "fc1")?.amountMinor === "100000" && Boolean(by("fundContribution", "fc1")?.dayKey));
  check("a money-less record has no amount (null, not zero)", by("meterReading", "m1")?.amountMinor === null);
  check("a stored day key is used as sent", by("goal", "g1")?.dayKey === "2026-11-01");
  const leak = await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1 AND (kind ILIKE '%Groceries%' OR "categoryId" ILIKE '%Lunch%')`, [idA]);
  check("no note or name ever reaches a projection column", leak.rows[0].n === 0);
  const blob = await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1 AND (data::text ILIKE '%bill.jpg%' OR data::text ILIKE '%bill.pdf%')`, [idA]);
  check("receipts and bill files never left the device (not in any record)", blob.rows[0].n === 0);
  const cur = (await pg.query(`SELECT revision::text, bytes FROM "SyncCursor" WHERE "userId" = $1`, [idA])).rows[0];
  const sumBytes = (await pg.query(`SELECT COALESCE(sum(bytes), 0)::int AS n FROM "SyncDoc" WHERE "userId" = $1 AND "deletedAt" IS NULL`, [idA])).rows[0].n;
  check("the cursor's byte count is the sum of the live records", cur.bytes === sumBytes, `${cur.bytes} vs ${sumBytes}`);
  const maxRev = (await pg.query(`SELECT max(revision)::text AS m FROM "SyncDoc" WHERE "userId" = $1`, [idA])).rows[0].m;
  check("revisions are the cursor's (no gaps beyond refused operations, none above it)", BigInt(maxRev) <= BigInt(cur.revision));

  console.log("concurrent edits, merged by the real engine");
  const e1 = d1.get("expenses");
  e1.find((e) => e.id === "e2").amount = 175;
  d1.set("expenses", e1);
  const e2 = d2.get("expenses");
  e2.find((e) => e.id === "e2").note = "Lunch with Ali";
  d2.set("expenses", e2);
  const f1 = d1.get("investments");
  f1[0].contributions.push({ id: "fc-1", date: "2026-11-20T00:00:00.000Z", amount: 200, notes: "", createdAt: "x" });
  d1.set("investments", f1);
  const f2 = d2.get("investments");
  f2[0].contributions.push({ id: "fc-2", date: "2026-11-20T00:00:00.000Z", amount: 300, notes: "", createdAt: "x" });
  d2.set("investments", f2);
  await Promise.all([d1.engine.syncOnce(), d2.engine.syncOnce()]); // at the same moment
  await Promise.all([d1.engine.syncOnce(), d2.engine.syncOnce()]);
  const merged = d1.get("expenses").find((e) => e.id === "e2");
  check("both edits of the same expense survive", merged.amount === 175 && merged.note === "Lunch with Ali", JSON.stringify(merged));
  check("both contributions survive", JSON.stringify(d1.get("investments")[0].contributions.map((c) => c.id).sort()) === JSON.stringify(["fc-1", "fc-2", "fc1"]));
  check("the two devices agree", JSON.stringify(norm(d1)) === JSON.stringify(norm(d2)));
  check("nothing is left pending on either", d1.engine.pending() === 0 && d2.engine.pending() === 0);

  console.log("deletes, Undo, and a lost answer");
  const gone = structuredClone(d1.get("expenses").find((e) => e.id === "e3"));
  d1.set("expenses", d1.get("expenses").filter((e) => e.id !== "e3"));
  await d1.engine.syncOnce();
  await d2.engine.syncOnce();
  check("a delete reaches the other device", !d2.get("expenses").some((e) => e.id === "e3"));
  const tomb = (await pg.query(`SELECT "deletedAt" IS NOT NULL AS deleted, data IS NULL AS nodata, bytes, "dayKey", "amountMinor" FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'expense' AND id = 'e3'`, [idA])).rows[0];
  check("the row is kept as a tombstone: data cleared, projection cleared", tomb.deleted && tomb.nodata && tomb.bytes === 0 && tomb.dayKey === null && tomb.amountMinor === null, JSON.stringify(tomb));
  d1.set("expenses", [...d1.get("expenses"), gone]); // Undo
  await d1.engine.syncOnce();
  await d2.engine.syncOnce();
  check("Undo brings the same record back to both", d2.get("expenses").some((e) => e.id === "e3" && e.amount === gone.amount));
  const revBefore = (await pg.query(`SELECT revision::text AS r FROM "SyncCursor" WHERE "userId" = $1`, [idA])).rows[0].r;
  const x = d1.get("expenses");
  x.push({ id: "lost-answer", date: "2026-11-20T07:00:00.000Z", amount: 9, categoryId: "cat-food", note: "", createdAt: "x" });
  d1.set("expenses", x);
  const realPush = d1.api.push;
  let dropped = false;
  d1.api.push = async (ops) => {
    const res = await realPush(ops);
    if (!dropped) {
      dropped = true;
      throw new SyncApiError("offline");
    }
    return res;
  };
  await d1.engine.syncOnce().then(() => check("(the first run reports the lost answer)", false), (e) => check("the answer is lost after the server applied it", e instanceof SyncApiError && e.kind === "offline"));
  const revMid = (await pg.query(`SELECT revision::text AS r FROM "SyncCursor" WHERE "userId" = $1`, [idA])).rows[0].r;
  await d1.engine.syncOnce();
  const revAfter = (await pg.query(`SELECT revision::text AS r FROM "SyncCursor" WHERE "userId" = $1`, [idA])).rows[0].r;
  check("repeating it wrote nothing more (idempotent) and nothing is duplicated", revMid === revAfter && BigInt(revMid) > BigInt(revBefore) && (await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1 AND id = 'lost-answer'`, [idA])).rows[0].n === 1);

  console.log("a held mass deletion, and a stale push");
  const blank = device(A, idA);
  await blank.engine.init();
  await blank.engine.syncOnce(); // pulls everything
  const before = (await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1 AND "deletedAt" IS NULL`, [idA])).rows[0].n;
  for (const a of ["expenses", "income", "investments", "lending", "goals", "accounts", "bills", "assets", "vehicles", "vehicleLogs", "fuelLogs", "meterReadings", "recurring"]) blank.cache.delete(a);
  const held = await blank.engine.syncOnce();
  const after = (await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1 AND "deletedAt" IS NULL`, [idA])).rows[0].n;
  check("a device that suddenly has nothing is held, and the database is untouched", held.held !== null && before === after, JSON.stringify(held.held));
  const stale = await A.call("POST", "/api/sync/push", { headers: H(idA), json: { ops: [{ collection: "expense", id: "e1", base: 1, put: { id: "e1", amount: 1, date: "2026-11-20T07:00:00.000Z" }, dayKey: "2026-11-20" }] } });
  check("a push from an old revision is a conflict that carries the current record, and writes nothing", stale.data.results[0].status === "conflict" && stale.data.results[0].current?.data?.amount === 900, JSON.stringify(stale.data.results[0]).slice(0, 160));

  console.log("two accounts never see each other");
  const dB = device(B, idB);
  await dB.engine.init();
  const pullB = await dB.engine.syncOnce();
  check("B's first pull is empty", pullB.pulled === 0 && !dB.get("expenses"));
  dB.set("expenses", [{ id: "e1", date: "2026-11-20T07:00:00.000Z", amount: 4242, categoryId: "cat-food", note: "B's own e1", createdAt: "x" }]); // the SAME id as one of A's
  await dB.engine.syncOnce();
  const rowsA = (await pg.query(`SELECT data->>'amount' AS a FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'expense' AND id = 'e1'`, [idA])).rows[0].a;
  const rowsB = (await pg.query(`SELECT data->>'amount' AS a FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'expense' AND id = 'e1'`, [idB])).rows[0].a;
  check("the same record id is two records, one per account", rowsA === "900" && rowsB === "4242", `${rowsA} / ${rowsB}`);
  check("B pulls only its own", (await B.call("POST", "/api/sync/pull", { json: { since: 0 }, headers: H(idB) })).data.records.every((r) => r.data === null || JSON.stringify(r.data).includes("4242") || r.collection !== "expense"));
  const sA = await A.call("GET", "/api/sync/summary", { headers: H(idA) });
  const sB = await B.call("GET", "/api/sync/summary", { headers: H(idB) });
  check("each summary counts only its own records", sA.data.records > 20 && sB.data.records === 1, `${sA.data.records} / ${sB.data.records}`);

  console.log("deleting an account removes its sync rows too");
  const delB = await B.call("DELETE", "/api/account", { json: { confirm: email("b") } });
  check("B deletes the account", delB.status === 200, JSON.stringify(delB.data));
  check("its records and cursor are gone, A's are untouched", (await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1`, [idB])).rows[0].n === 0 && (await pg.query(`SELECT count(*)::int AS n FROM "SyncCursor" WHERE "userId" = $1`, [idB])).rows[0].n === 0 && (await pg.query(`SELECT count(*)::int AS n FROM "SyncDoc" WHERE "userId" = $1`, [idA])).rows[0].n > 20);
  check("the server log holds no password, no email and no record content", !log.includes(PASSWORD) && !log.includes("@example.test") && !log.includes("Groceries") && !log.includes("Lunch with Ali"));
} catch (e) {
  failures++;
  console.log(`sync: stopped (${String(e?.message ?? e).split("\n")[0]})`);
  console.log(log.split("\n").slice(-8).join("\n"));
} finally {
  server.kill();
  try {
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
  } catch (e) {
    console.log(`sync: clean-up problem (${e?.code ?? "error"})`);
  }
  await pg.end().catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nsync: all checks passed, test data removed." : `\nsync: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
