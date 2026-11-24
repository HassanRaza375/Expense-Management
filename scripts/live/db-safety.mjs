// Real-service check, run BY HAND: `node scripts/live/db-safety.mjs`. Never part of `npm run verify`.
//
// Answers one question before anything is written to the database: is the target the TEST database (see testDb.mjs: `defaultdb`, the owner's choice,
// or a database whose name says test/preview/dev/...), and does it hold only Hisaab's tables (or none)? It prints ONLY the decision and counts, never the
// URL, host, user, password, certificate or any value from .env.
//
//   exit 0  safe to use      exit 1  refused (say so to the owner)      exit 2  could not connect (a code, never a host or credential)
import { connect, describeFailure, resolveTestDb, tablesOf } from "./testDb.mjs";

const target = resolveTestDb();
if (target.error) {
  console.log(`db-safety: REFUSED. ${target.error} Nothing was connected to.`);
  process.exit(1);
}
console.log(`db-safety: target is the database "${target.name}"${target.swapped ? " (the owner's test database; the name in .env was replaced in memory, .env is untouched)" : ""}.`);

let client;
try {
  client = await connect(target.url);
} catch (e) {
  console.log(`db-safety: ${describeFailure(e)}`);
  process.exit(2);
}
try {
  const others = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','pg_catalog','pg_toast') AND table_schema <> $1 AND table_type = 'BASE TABLE'`, [target.schema]);
  const { tables, foreign } = await tablesOf(client, target.schema);
  console.log(`db-safety: connected (certificate checked). Hisaab works only in the schema "${target.schema}": ${tables.length} table(s) there. ${others.rows[0].n} table(s) elsewhere in this database are not Hisaab's and are never touched.`);
  if (foreign.length) {
    console.log(`db-safety: REFUSED. The schema "${target.schema}" holds ${foreign.length} table(s) that are not Hisaab's (${foreign.slice(0, 8).join(", ")}${foreign.length > 8 ? ", ..." : ""}).`);
    process.exit(1);
  }
  console.log(tables.length === 0 ? "db-safety: it is empty. Safe to migrate." : "db-safety: it holds only Hisaab's tables. Safe to use.");
  process.exit(0);
} finally {
  await client.end().catch(() => undefined);
}
