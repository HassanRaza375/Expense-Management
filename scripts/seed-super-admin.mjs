// Creates the super admin account. Run by the OWNER, by hand, once per database:   node scripts/seed-super-admin.mjs
//
//   ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are read from the environment (or the local .env) HERE and nowhere else: the app never reads them.
//   The password must be at least 12 characters. Neither value is printed, logged or stored anywhere except as the account (the password as Better Auth's hash).
//   Run again to repair the account or set a new password. It targets DATABASE_URL (its `?schema=` if any), so point DATABASE_URL at the database you mean.
//   Production: set the two variables for the shell session only, run this once, then remove them (docs/DEPLOY.md).
import { connect, describeFailure, schemaOf } from "./lib/pgConnect.mjs";
import { SeedError, seedSuperAdmin } from "./lib/seedSuperAdmin.mjs";

try {
  process.loadEnvFile();
} catch {
  /* no .env: the variables may already be set */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed-super-admin: DATABASE_URL is not set.");
  process.exit(1);
}

let client;
try {
  client = await connect(url);
} catch (e) {
  console.error(`seed-super-admin: ${describeFailure(e)}`);
  process.exit(2);
}
try {
  const outcome = await seedSuperAdmin(client, process.env.ADMIN_SEED_EMAIL, process.env.ADMIN_SEED_PASSWORD);
  console.log(`seed-super-admin: super admin ${outcome} (schema "${schemaOf(url)}").`);
} catch (e) {
  if (e instanceof SeedError) {
    console.error(`seed-super-admin: ${e.message}`);
    process.exit(1);
  }
  console.error(`seed-super-admin: failed (${e && typeof e === "object" && "code" in e ? e.code : "error"}).`);
  process.exit(3);
} finally {
  await client.end().catch(() => undefined);
}
