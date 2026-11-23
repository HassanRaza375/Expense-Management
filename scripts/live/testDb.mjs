// Shared by the scripts in scripts/live/*. Decides WHICH database the real-service checks may touch, and connects to it. Prints no secret.
//
// The owner's decision (2026-11-20): the TEST database is `defaultdb` on the same Aiven service that .env points at. .env itself is never edited:
// the host and credentials come from DATABASE_URL and only the database NAME is swapped here, in memory. A database whose name already says
// test/preview/dev/staging/sandbox/tmp/scratch is used as it is. Anything else is refused. `defaultdb` is shared with whatever else the owner keeps there
// (it holds a `notes` table that is not Hisaab's), so Hisaab's test tables live in their OWN schema, `hisaab_test`: nothing outside it is ever read, changed or removed.
import { connect, describeFailure, readCa, schemaOf } from "../lib/pgConnect.mjs";

try {
  process.loadEnvFile();
} catch {
  /* no .env: variables may already be set */
}

export { connect, describeFailure, readCa, schemaOf };
export const OWNER_TEST_DB = "defaultdb";
export const TEST_SCHEMA = "hisaab_test";
const LOOKS_LIKE_TEST = /(^|[_-])(test|tests|testing|preview|dev|staging|sandbox|tmp|scratch)([_-]|$)/i;
export const HISAAB_TABLES = new Set(["SyncDoc", "SyncCursor", "AuditLog", "User", "Session", "Account", "Verification", "RateLimit", "_prisma_migrations"]);

/** { url, name, schema, swapped } of the test database, or { error } when there is no usable DATABASE_URL. */
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
  if (name === OWNER_TEST_DB && !u.searchParams.get("schema")) u.searchParams.set("schema", TEST_SCHEMA);
  return { url: u.toString(), name, schema: schemaOf(u.toString()), swapped: name !== envName };
}

/** { tables, foreign } for one schema (default public). A schema that does not exist yet has no tables. */
export async function tablesOf(client, schema = "public") {
  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`, [schema]);
  const tables = rows.map((r) => r.table_name);
  return { tables, foreign: tables.filter((t) => !HISAAB_TABLES.has(t)) };
}
