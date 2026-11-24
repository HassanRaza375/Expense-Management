// Real-service step, run BY HAND: `node scripts/live/migrate-test.mjs`. Applies prisma/migrations to the TEST database's own schema (see testDb.mjs) and nothing else.
// Refuses unless the safety check passes. Prints no secret. Production is never migrated from here: that is the owner's step (docs/DEPLOY.md).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, describeFailure, readCa, resolveTestDb, tablesOf } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`migrate-test: REFUSED. ${target.error}`);
  process.exit(1);
}

// the same check as db-safety.mjs
let client;
try {
  client = await connect(target.url);
} catch (e) {
  console.log(`migrate-test: ${describeFailure(e)}`);
  process.exit(2);
}
const { foreign } = await tablesOf(client, target.schema);
await client.end();
if (foreign.length) {
  console.log(`migrate-test: REFUSED. The schema "${target.schema}" holds tables that are not Hisaab's.`);
  process.exit(1);
}

// Prisma's schema engine verifies the certificate when given sslmode=verify-full and a root-certificate FILE: write the CA to a temporary file for the run.
const dir = mkdtempSync(path.join(tmpdir(), "hisaab-ca-"));
try {
  const u = new URL(target.url);
  const ca = readCa();
  if (ca) {
    const file = path.join(dir, "ca.pem");
    writeFileSync(file, ca + "\n");
    for (const k of ["sslmode", "sslrootcert"]) u.searchParams.delete(k);
    u.searchParams.set("sslmode", "verify-full");
    u.searchParams.set("sslrootcert", file);
  }
  console.log(`migrate-test: applying migrations to "${target.name}", schema "${target.schema}" ...`);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const run = spawnSync(npx, ["prisma", "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: u.toString() }, encoding: "utf8", shell: process.platform === "win32" });
  // print Prisma's output with the connection string and host removed
  const scrub = (t) => t.split(u.toString()).join("[url]").split(u.hostname).join("[host]").split(decodeURIComponent(u.password || "x-none")).join("[x]");
  console.log(scrub(`${run.stdout ?? ""}${run.stderr ?? ""}`).split("\n").filter((l) => !/^Datasource|^Loaded Prisma config|^Prisma schema loaded/.test(l)).join("\n"));
  console.log(run.status === 0 ? "migrate-test: done." : `migrate-test: FAILED (exit ${run.status}).`);
  process.exit(run.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
