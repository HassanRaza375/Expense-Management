import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("unit tests can reach no real service", () => {
  it("every credential is blank and sync is off", () => {
    for (const name of ["DATABASE_URL", "DATABASE_CA_CERT", "BETTER_AUTH_SECRET", "CLOUDINARY_URL", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "GOOGLE_CLIENT_SECRET", "ADMIN_SEED_PASSWORD"]) {
      expect(process.env[name], name).toBe("");
    }
    expect(process.env.NUXT_PUBLIC_SYNC_ENABLED).toBe("0");
  });

  it("the setup file lists every variable the docs name", () => {
    const src = readFileSync(fileURLToPath(new URL("./setup/noServices.ts", import.meta.url)), "utf8");
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "CLOUDINARY_URL", "CLOUDINARY_API_SECRET", "ADMIN_SEED_EMAIL", "ADMIN_SEED_PASSWORD", "GOOGLE_CLIENT_SECRET", "RESEND_API_KEY"]) {
      expect(src, name).toContain(`"${name}"`);
    }
  });
});

describe("repository rules", () => {
  it(".env files are ignored by git", () => {
    const ignore = readFileSync(fileURLToPath(new URL("../.gitignore", import.meta.url)), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
  });

  it("no secret reaches runtimeConfig from process.env in nuxt.config.ts", () => {
    const cfg = readFileSync(fileURLToPath(new URL("../nuxt.config.ts", import.meta.url)), "utf8");
    // process.env may only appear for public, non-secret values; today it must not appear at all
    expect(cfg).not.toMatch(/process\.env/);
    expect(cfg).not.toMatch(/SECRET|PASSWORD|API_KEY|DATABASE_URL|CLOUDINARY_URL/);
  });
});
