import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { MIN_SEED_PASSWORD, SeedError, checkSeedInput, seedSuperAdmin } from "../scripts/lib/seedSuperAdmin.mjs";

const PASSWORD = "A-long-test-password-1";

/** A pg client that records every query and answers from a tiny in-memory state. */
function fakePg(existing?: { id: string; credential?: boolean }) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      log.push({ sql, params });
      if (/^SELECT id FROM "User"/.test(sql)) return { rows: existing ? [{ id: existing.id }] : [] };
      if (/^SELECT id FROM "Account"/.test(sql)) return { rows: existing?.credential ? [{ id: "acc-1" }] : [] };
      return { rows: [] };
    },
  };
  return { client, log };
}

describe("checkSeedInput", () => {
  it("normalises the email and accepts a long enough password", () => {
    expect(checkSeedInput("  Admin@Example.TEST ", PASSWORD)).toBe("admin@example.test");
  });
  it("refuses a missing or invalid email, a missing, short or huge password, and its messages never contain either value", () => {
    const attempts: Array<[unknown, unknown, string]> = [
      [undefined, PASSWORD, "EMAIL_MISSING"],
      ["", PASSWORD, "EMAIL_MISSING"],
      ["not-an-email", PASSWORD, "EMAIL_INVALID"],
      ["a@b.test", undefined, "PASSWORD_MISSING"],
      ["a@b.test", "", "PASSWORD_MISSING"],
      ["a@b.test", "x".repeat(MIN_SEED_PASSWORD - 1), "PASSWORD_SHORT"],
      ["a@b.test", "x".repeat(129), "PASSWORD_LONG"],
    ];
    for (const [e, p, code] of attempts) {
      try {
        checkSeedInput(e, p);
        expect.unreachable(code);
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        expect((err as SeedError & { code: string }).code).toBe(code);
        for (const v of [p, e]) if (typeof v === "string" && v.length >= 3) expect(String((err as Error).message)).not.toContain(v);
      }
    }
    expect(MIN_SEED_PASSWORD).toBeGreaterThanOrEqual(12);
  });
});

describe("seedSuperAdmin", () => {
  it("creates the user and a credential account in one transaction, with the password as a hash", async () => {
    const { client, log } = fakePg();
    expect(await seedSuperAdmin(client, "Admin@Example.test", PASSWORD)).toBe("created");
    const sql = log.map((l) => l.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.at(-1)).toBe("COMMIT");
    const insertUser = log.find((l) => /^INSERT INTO "User"/.test(l.sql))!;
    expect(insertUser.sql).toContain("'superadmin'");
    expect(insertUser.params).toContain("admin@example.test");
    const insertAccount = log.find((l) => /^INSERT INTO "Account"/.test(l.sql))!;
    expect(insertAccount.sql).toContain("'credential'");
    const hash = insertAccount.params.find((p) => typeof p === "string" && (p as string).length > 40) as string;
    expect(hash).toBeTruthy();
    expect(hash).not.toContain(PASSWORD);
  });

  it("the plain password appears in no query text and no parameter", async () => {
    const { client, log } = fakePg();
    await seedSuperAdmin(client, "admin@example.test", PASSWORD);
    expect(JSON.stringify(log)).not.toContain(PASSWORD);
  });

  it("an existing user becomes an enabled, confirmed super admin and gets the new password", async () => {
    const { client, log } = fakePg({ id: "u-9", credential: true });
    expect(await seedSuperAdmin(client, "admin@example.test", PASSWORD)).toBe("updated");
    const update = log.find((l) => /^UPDATE "User"/.test(l.sql))!;
    expect(update.sql).toMatch(/role = 'superadmin'/);
    expect(update.sql).toMatch(/disabled = false/);
    expect(log.some((l) => /^INSERT INTO "User"/.test(l.sql))).toBe(false);
    expect(log.some((l) => /^UPDATE "Account" SET password/.test(l.sql))).toBe(true);
  });

  it("an existing user with no password sign-in method (a Google account) gets one", async () => {
    const { client, log } = fakePg({ id: "u-9", credential: false });
    await seedSuperAdmin(client, "admin@example.test", PASSWORD);
    expect(log.some((l) => /^INSERT INTO "Account"/.test(l.sql))).toBe(true);
  });

  it("a failure rolls back and a bad input never opens a transaction", async () => {
    const { client, log } = fakePg();
    await expect(seedSuperAdmin(client, "admin@example.test", "short")).rejects.toBeInstanceOf(SeedError);
    expect(log).toEqual([]);
    const failing = {
      async query(sql: string) {
        log.push({ sql, params: [] });
        if (/^INSERT INTO "User"/.test(sql)) throw new Error("boom");
        return { rows: [] };
      },
    };
    await expect(seedSuperAdmin(failing, "admin@example.test", PASSWORD)).rejects.toThrow("boom");
    expect(log.at(-1)!.sql).toBe("ROLLBACK");
  });
});

describe("the seed script prints no secret", () => {
  const src = readFileSync(fileURLToPath(new URL("../scripts/seed-super-admin.mjs", import.meta.url)), "utf8");
  it("never writes the email or the password to the output", () => {
    for (const m of src.matchAll(/console\.(log|error|warn|info)\(([^;]*)\);/g)) expect(m[2], m[0]).not.toMatch(/ADMIN_SEED|password|email(?!\s)/i);
  });
  it("is the only place that reads the two seed variables (the app never does)", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const n of readdirSync(dir)) {
        if (["node_modules", "generated", ".nuxt", ".output"].includes(n)) continue;
        const p = `${dir}/${n}`;
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (/\.(ts|vue|js|mjs)$/.test(n)) out.push(p);
      }
      return out;
    };
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders = [...walk(`${root}server`), ...walk(`${root}app`), `${root}nuxt.config.ts`].filter((f) => /ADMIN_SEED_(EMAIL|PASSWORD)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
