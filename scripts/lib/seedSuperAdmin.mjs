// Creates (or repairs) the super admin account. The pure part of scripts/seed-super-admin.mjs, separate so a test can run it against the TEST database.
// The password is hashed with Better Auth's own function (the one the sign-in route verifies with). Nothing here prints the email or the password.
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "node:crypto";

export const MIN_SEED_PASSWORD = 12;

export class SeedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const id = () => randomBytes(16).toString("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the two values; returns the normalised email. Messages never contain either value. */
export function checkSeedInput(email, password) {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!e) throw new SeedError("EMAIL_MISSING", "ADMIN_SEED_EMAIL is not set.");
  if (!EMAIL.test(e) || e.length > 254) throw new SeedError("EMAIL_INVALID", "ADMIN_SEED_EMAIL is not a valid email address.");
  if (typeof password !== "string" || password === "") throw new SeedError("PASSWORD_MISSING", "ADMIN_SEED_PASSWORD is not set.");
  if (password.length < MIN_SEED_PASSWORD) throw new SeedError("PASSWORD_SHORT", `ADMIN_SEED_PASSWORD is shorter than ${MIN_SEED_PASSWORD} characters.`);
  if (password.length > 128) throw new SeedError("PASSWORD_LONG", "ADMIN_SEED_PASSWORD is longer than 128 characters.");
  return e;
}

/**
 * Inside one transaction: no user with that email -> create the user (role superadmin, address confirmed) and its email-and-password sign-in method;
 * a user exists -> make it an enabled super admin and set the password. Returns "created" or "updated". `client` is a connected pg client whose search_path is the schema.
 */
export async function seedSuperAdmin(client, email, password) {
  const e = checkSeedInput(email, password);
  const hash = await hashPassword(password);
  await client.query("BEGIN");
  try {
    const found = await client.query(`SELECT id FROM "User" WHERE email = $1`, [e]);
    let userId;
    let outcome;
    if (found.rows.length === 0) {
      userId = id();
      await client.query(`INSERT INTO "User" (id, name, email, "emailVerified", role, disabled, "createdAt", "updatedAt") VALUES ($1, $2, $3, true, 'superadmin', false, now(), now())`, [userId, "Super admin", e]);
      outcome = "created";
    } else {
      userId = found.rows[0].id;
      await client.query(`UPDATE "User" SET role = 'superadmin', disabled = false, "emailVerified" = true, "updatedAt" = now() WHERE id = $1`, [userId]);
      outcome = "updated";
    }
    const cred = await client.query(`SELECT id FROM "Account" WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId]);
    if (cred.rows.length === 0) {
      await client.query(`INSERT INTO "Account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, 'credential', $2, $3, now(), now())`, [id(), userId, hash]);
    } else {
      await client.query(`UPDATE "Account" SET password = $2, "updatedAt" = now() WHERE id = $1`, [cred.rows[0].id, hash]);
    }
    await client.query("COMMIT");
    return outcome;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
