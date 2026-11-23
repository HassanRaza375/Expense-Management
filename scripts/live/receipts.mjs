// Real-service check for Phase 6, run BY HAND (needs `npm run build` first): `node scripts/live/receipts.mjs`.
// Starts the built server (sync flag ON) on a spare port against the TEST database and REAL Cloudinary under the folder `hisaab-test`, then walks the receipt flows over HTTP:
// the record must exist before a file is accepted, files are PRIVATE (no public or unsigned address works), the signed address works and is short-lived, one account cannot
// reach another's receipt, deleting an expense never deletes a file, and only the confirmed clean-up (and account deletion) removes files. Everything it creates is removed.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";
import { connect, resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`receipts: REFUSED. ${target.error}`);
  process.exit(1);
}
const PORT = "3036";
const BASE = `http://localhost:${PORT}`;
const FOLDER = "hisaab-test";
const RUN = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("hex")}`;
const email = (n) => `live-${RUN}-${n}@example.test`;
const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL ?? "");
const cld = m ? { api_key: m[1], api_secret: m[2], cloud_name: m[3], secure: true } : null;
if (!cld) {
  console.log("receipts: CLOUDINARY_URL is not set; nothing was checked.");
  process.exit(1);
}
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

// a real (tiny) PNG, and a minimal PDF
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const env = { ...process.env, PORT, NITRO_PORT: PORT, NUXT_PUBLIC_SYNC_ENABLED: "1", DATABASE_URL: target.url, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"), BETTER_AUTH_URL: BASE, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "", EMAIL_FROM: "", CLOUDINARY_FOLDER: FOLDER };
const server = spawn(process.execPath, [".output/server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let ip = 60;
function browser() {
  const jar = new Map();
  const addr = `10.60.70.${ip++}`;
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
    return { status: res.status, data };
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

  const A = browser();
  const B = browser();
  await A("POST", "/api/auth/sign-up/email", { json: { name: "A", email: email("a"), password: PASSWORD } });
  await B("POST", "/api/auth/sign-up/email", { json: { name: "B", email: email("b"), password: PASSWORD } });
  const idA = (await A("GET", "/api/account")).data.id;
  const idB = (await B("GET", "/api/account")).data.id;
  created.push(idA, idB);
  const H = (id) => ({ "x-hisaab-schema": "3", "x-hisaab-account": id });
  const push = (c, id, ops) => c("POST", "/api/sync/push", { json: { ops }, headers: H(id) });
  const expense = (id) => ({ collection: "expense", id, base: 0, put: { id, date: "2026-11-20T07:00:00.000Z", amount: 5, categoryId: "c" }, dayKey: "2026-11-20" });
  const receipt = (id, expenseId, mime, size) => ({ collection: "receipt", id, base: 0, put: { id, expenseId, filename: "r", mimeType: mime, size }, dayKey: null });
  const put = (c, id, body, type = "image/png") => c("PUT", `/api/receipts/${id}`, { body, headers: { "content-type": type } });

  console.log("a file needs its record first");
  check("an upload for a receipt that was never synced is 404", (await put(A, "r-png", PNG)).status === 404);
  await push(A, idA, [expense("e1"), receipt("r-png", "e1", "image/png", PNG.length), receipt("r-pdf", "e1", "application/pdf", PDF.length)]);
  check("an upload with no session is 401", (await put(browser(), "r-png", PNG)).status === 401);
  check("an upload from another origin is 403", (await A("PUT", "/api/receipts/r-png", { body: PNG, headers: { "content-type": "image/png" }, origin: "https://evil.example" })).status === 403);

  console.log("what is accepted");
  check("a text file is 415", (await put(A, "r-png", Buffer.from("hello, not a receipt"))).status === 415);
  check("an empty file is 400", (await put(A, "r-png", Buffer.alloc(0))).status === 400);
  check("a file over 10 MB is 413", (await put(A, "r-png", Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1)]))).status === 413);
  const upPng = await put(A, "r-png", PNG);
  check("a PNG is accepted", upPng.status === 200, JSON.stringify(upPng.data));
  const upPdf = await put(A, "r-pdf", PDF, "application/pdf");
  check("a PDF is accepted", upPdf.status === 200, JSON.stringify(upPdf.data));

  console.log("the files are private, and the signed address is short-lived");
  cloudinary.config(cld);
  const pid = `${FOLDER}/u/${idA}/receipts/r-png`;
  const listing = await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}/receipts` });
  check("both files are in the account's own folder as AUTHENTICATED (private) resources", listing.resources.length === 2 && listing.resources.every((r) => r.type === "authenticated"), JSON.stringify(listing.resources.map((r) => r.type)));
  const publicTry = await fetch(`https://res.cloudinary.com/${cld.cloud_name}/image/upload/${pid}.png`);
  check("no public address works", publicTry.status >= 400, String(publicTry.status));
  const unsigned = await fetch(`https://res.cloudinary.com/${cld.cloud_name}/image/authenticated/${pid}.png`);
  check("an unsigned private address is refused", unsigned.status === 401 || unsigned.status === 403 || unsigned.status === 404, String(unsigned.status));
  const url = await A("GET", "/api/receipts/r-png");
  check("the owner gets a signed address that expires in 5 minutes", url.status === 200 && url.data.expiresIn === 300 && /expires_at=\d+/.test(url.data.url), JSON.stringify(url.data).slice(0, 120));
  const exp = Number(/expires_at=(\d+)/.exec(url.data.url)?.[1] ?? 0);
  const now = Math.floor(Date.now() / 1000);
  check("its expiry is about 5 minutes from now", exp - now > 240 && exp - now <= 305, String(exp - now));
  const got = await fetch(url.data.url);
  const bytes = Buffer.from(await got.arrayBuffer());
  check("the signed address returns the file", got.ok && bytes.length > 50, `${got.status} ${bytes.length}`);
  const tampered = await fetch(url.data.url.replace(/signature=[0-9a-f]+/, "signature=0000000000000000000000000000000000000000"));
  check("a tampered signature is refused", !tampered.ok, String(tampered.status));
  const urlPdf = await A("GET", "/api/receipts/r-pdf");
  const gotPdf = await fetch(urlPdf.data.url);
  const pdfBytes = Buffer.from(await gotPdf.arrayBuffer());
  check("the PDF is returned too", gotPdf.ok && pdfBytes.subarray(0, 5).toString() === "%PDF-", `${gotPdf.status} ${pdfBytes.subarray(0, 8).toString("latin1")}`);

  console.log("one account never reaches another's receipts");
  check("B cannot get a link to A's receipt", (await B("GET", "/api/receipts/r-png")).status === 404);
  check("B cannot upload over A's receipt", (await put(B, "r-png", PNG)).status === 404);
  await push(B, idB, [expense("e1"), receipt("r-png", "e1", "image/png", PNG.length)]); // the same receipt id in B's own account
  check("B's same-named receipt is B's own (separate folder)", (await put(B, "r-png", PNG)).status === 200 && (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idB}/receipts` })).resources.length === 1);
  check("and A's file is untouched", (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}/receipts` })).resources.length === 2);

  console.log("deleting never deletes a file; the clean-up does, after confirmation");
  const rev = (await pg.query(`SELECT revision::text AS r FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'expense' AND id = 'e1'`, [idA])).rows[0].r;
  const revR = (await pg.query(`SELECT revision::text AS r FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'receipt' AND id = 'r-png'`, [idA])).rows[0].r;
  const revP = (await pg.query(`SELECT revision::text AS r FROM "SyncDoc" WHERE "userId" = $1 AND collection = 'receipt' AND id = 'r-pdf'`, [idA])).rows[0].r;
  await push(A, idA, [{ collection: "expense", id: "e1", base: Number(rev), delete: true }, { collection: "receipt", id: "r-png", base: Number(revR), delete: true }, { collection: "receipt", id: "r-pdf", base: Number(revP), delete: true }]);
  check("with the expense and the receipt record deleted, both files are still there", (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}/receipts` })).resources.length === 2);
  check("a deleted receipt has no signed address", (await A("GET", "/api/receipts/r-png")).status === 404);
  const dry = await A("POST", "/api/receipts/cleanup", { json: {} });
  check("the clean-up first only counts what would go", dry.status === 200 && dry.data.orphans === 2 && dry.data.removed === 0, JSON.stringify(dry.data));
  check("(and removed nothing)", (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}/receipts` })).resources.length === 2);
  const done = await A("POST", "/api/receipts/cleanup", { json: { confirm: true } });
  check("confirmed, it removes the orphans from Cloudinary", done.status === 200 && done.data.removed === 2, JSON.stringify(done.data));
  check("A's folder is empty and B's file is untouched", (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idA}/receipts` })).resources.length === 0 && (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idB}/receipts` })).resources.length === 1);
  check("the clean-up of an account with no orphans removes nothing", (await B("POST", "/api/receipts/cleanup", { json: { confirm: true } })).data.removed === 0);

  console.log("deleting the account removes the files too");
  const del = await B("DELETE", "/api/account", { json: { confirm: email("b") } });
  check("B deletes the account", del.status === 200 && del.data.cleanup === "done", JSON.stringify(del.data));
  check("its receipt files are gone from Cloudinary", (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix: `${FOLDER}/u/${idB}` })).resources.length === 0);
  check("the server log holds no password, no address and no file content", !log.includes(PASSWORD) && !log.includes("@example.test"));
} catch (e) {
  failures++;
  console.log(`receipts: stopped (${String(e?.message ?? e).split("\n")[0]})`);
  console.log(log.split("\n").slice(-6).join("\n"));
} finally {
  server.kill();
  try {
    await pg.query(`DELETE FROM "User" WHERE email LIKE $1`, [`live-${RUN}-%@example.test`]);
    await pg.query(`DELETE FROM "RateLimit"`);
    cloudinary.config(cld);
    for (const id of created) {
      for (const type of ["upload", "authenticated"]) await cloudinary.api.delete_resources_by_prefix(`${FOLDER}/u/${id}`, { type }).catch(() => undefined);
      await cloudinary.api.delete_folder(`${FOLDER}/u/${id}`).catch(() => undefined);
    }
  } catch (e) {
    console.log(`receipts: clean-up problem (${e?.code ?? "error"})`);
  }
  await pg.end().catch(() => undefined);
}
console.log(failures === 0 ? "\nreceipts: all checks passed, test data removed." : `\nreceipts: ${failures} check(s) FAILED, test data removed.`);
process.exit(failures === 0 ? 0 : 1);
