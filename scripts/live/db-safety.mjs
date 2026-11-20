// Real-service check, run BY HAND: `node scripts/live/db-safety.mjs`. Never part of `npm run verify`.
//
// Answers one question before anything is written to the database named in .env: is it a TEST or preview database, and is it empty of other apps' tables?
// It prints ONLY the decision and counts, never the URL, host, user, password, certificate or any value from .env.
//
//   exit 0  the database name looks like a test/preview one, the connection works (certificate checked, never switched off)
//   exit 1  it does not look like a test database, or it holds tables that are not Hisaab's: STOP and tell the owner
//   exit 2  could not connect (the reason is a code, never a host or credential)
import pg from "pg";
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile();
} catch {
  /* no .env: variables may already be set */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("db-safety: DATABASE_URL is not set. Nothing was checked.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.log("db-safety: DATABASE_URL is not a valid URL. Nothing was checked.");
  process.exit(1);
}

const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
// the same rule the other live scripts use: the database name must say test / preview / dev / staging / sandbox / tmp
const LOOKS_LIKE_TEST = /(^|[_-])(test|tests|testing|preview|dev|staging|sandbox|tmp|scratch)([_-]|$)/i;
if (!LOOKS_LIKE_TEST.test(dbName)) {
  console.log(`db-safety: REFUSED. The database name "${dbName}" does not look like a test or preview database (it must contain test, preview, dev, staging, sandbox, tmp or scratch as a whole word).`);
  console.log("db-safety: nothing was connected to. Create a TEST database, point DATABASE_URL at it, and run this again.");
  process.exit(1);
}

// the certificate: the same sources the server uses (DATABASE_CA_CERT as PEM text, or DATABASE_CA_FILE as a path). Checks are never turned off.
let ca = process.env.DATABASE_CA_CERT || "";
if (!ca && process.env.DATABASE_CA_FILE) {
  try {
    ca = readFileSync(process.env.DATABASE_CA_FILE, "utf8");
  } catch {
    console.log("db-safety: DATABASE_CA_FILE could not be read.");
    process.exit(2);
  }
}
ca = ca.replace(/\\n/g, "\n").trim();

const conn = new URL(url);
const config = { connectionString: url, max: 1, connectionTimeoutMillis: 15000 };
if (ca) {
  for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"]) conn.searchParams.delete(k);
  config.connectionString = conn.toString();
  config.ssl = { ca: ca + "\n", rejectUnauthorized: true };
}

const client = new pg.Client(config);
try {
  await client.connect();
} catch (e) {
  const code = e && typeof e === "object" && "code" in e ? String(e.code) : "unknown";
  console.log(`db-safety: could not connect (code ${code}).`);
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    console.log("db-safety: the server's certificate is not trusted. Give the project's CA as DATABASE_CA_CERT (PEM) or DATABASE_CA_FILE. Certificate checks are never switched off.");
  }
  process.exit(2);
}

try {
  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`);
  const tables = rows.map((r) => r.table_name);
  const HISAAB = new Set(["SyncDoc", "SyncCursor", "AuditLog", "User", "Session", "Account", "Verification", "RateLimit", "_prisma_migrations"]);
  const foreign = tables.filter((t) => !HISAAB.has(t));
  console.log(`db-safety: connected to a database named "${dbName}" (looks like a test database). Tables in schema public: ${tables.length}.`);
  if (foreign.length) {
    console.log(`db-safety: REFUSED. It holds ${foreign.length} table(s) that are not Hisaab's (${foreign.slice(0, 8).join(", ")}${foreign.length > 8 ? ", ..." : ""}). It may belong to another app. Use an empty database.`);
    process.exit(1);
  }
  console.log(tables.length === 0 ? "db-safety: it is empty. Safe to migrate." : "db-safety: it holds only Hisaab's tables. Safe to migrate.");
  process.exit(0);
} finally {
  await client.end().catch(() => undefined);
}
