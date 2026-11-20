// Shared by the scripts in scripts/live/*. Decides WHICH database the real-service checks may touch, and connects to it. Prints no secret.
//
// The owner's decision (2026-11-20): the TEST database is `defaultdb` on the same Aiven service that .env points at. .env itself is never edited:
// the host and credentials come from DATABASE_URL and only the database NAME is swapped here, in memory. A database whose name already says
// test/preview/dev/staging/sandbox/tmp/scratch is used as it is. Anything else is refused. The safety check (`checkSafe`) also refuses a database
// that holds tables that are not Hisaab's.
import pg from "pg";
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile();
} catch {
  /* no .env: variables may already be set */
}

export const OWNER_TEST_DB = "defaultdb";
export const TEST_SCHEMA = "hisaab_test";
const LOOKS_LIKE_TEST = /(^|[_-])(test|tests|testing|preview|dev|staging|sandbox|tmp|scratch)([_-]|$)/i;
export const HISAAB_TABLES = new Set(["SyncDoc", "SyncCursor", "AuditLog", "User", "Session", "Account", "Verification", "RateLimit", "_prisma_migrations"]);

/** { url, name } of the test database, or { error } when there is no usable DATABASE_URL. */
export function resolveTestDb() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return { error: "DATABASE_URL is not set." };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: "DATABASE_URL is not a valid URL." };
  }
  const envName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!LOOKS_LIKE_TEST.test(envName)) u.pathname = `/${OWNER_TEST_DB}`;
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (name !== OWNER_TEST_DB && !LOOKS_LIKE_TEST.test(name)) return { error: `"${name}" is not a test database.` };
  // `defaultdb` is shared with whatever else the owner keeps there (it holds a `notes` table that is not Hisaab's): Hisaab's test tables live in their OWN schema,
  // so nothing outside it is ever read, changed or removed. Prisma and the server both honour `?schema=`.
  if (name === OWNER_TEST_DB && !u.searchParams.get("schema")) u.searchParams.set("schema", TEST_SCHEMA);
  const schema = u.searchParams.get("schema") || "public";
  return { url: u.toString(), name, schema, swapped: name !== envName };
}

/** The CA text from DATABASE_CA_CERT or DATABASE_CA_FILE, or "" (checks are never switched off). */
export function readCa() {
  const BARE = /^[A-Za-z0-9+/=\s]{200,}$/;
  let ca = process.env.DATABASE_CA_CERT || "";
  const f = process.env.DATABASE_CA_FILE;
  // DATABASE_CA_FILE is a path; the certificate text itself (PEM, or its bare base64 body) pasted there is accepted too
  if (!ca && f) ca = /-----BEGIN CERTIFICATE-----/.test(f) || BARE.test(f.trim()) ? f : readFileSync(f, "utf8");
  ca = ca.replace(/\\n/g, "\n").trim();
  if (ca && !ca.includes("-----BEGIN") && BARE.test(ca)) {
    const body = ca.replace(/\s+/g, "");
    ca = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`;
  }
  return ca;
}

/** pg client options for the URL: with a CA, trust exactly it and keep checking the host name. */
export function clientConfig(url) {
  const config = { connectionString: url, max: 1, connectionTimeoutMillis: 15000 };
  const ca = readCa();
  if (ca) {
    const u = new URL(url);
    for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"]) u.searchParams.delete(k);
    config.connectionString = u.toString();
    config.ssl = { ca: ca + "\n", rejectUnauthorized: true };
  }
  return config;
}

export async function connect(url) {
  const client = new pg.Client(clientConfig(url));
  await client.connect();
  return client;
}

/** A short, secret-free description of a connection failure. */
export function describeFailure(e) {
  const code = e && typeof e === "object" && "code" in e ? String(e.code) : "unknown";
  const hint = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) ? " The server's certificate is not trusted: give the project's CA as DATABASE_CA_CERT (PEM) or DATABASE_CA_FILE. Certificate checks are never switched off." : "";
  return `could not connect (code ${code}).${hint}`;
}

/** { tables, foreign } for one schema (default public). A schema that does not exist yet has no tables. */
export async function tablesOf(client, schema = "public") {
  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`, [schema]);
  const tables = rows.map((r) => r.table_name);
  return { tables, foreign: tables.filter((t) => !HISAAB_TABLES.has(t)) };
}
