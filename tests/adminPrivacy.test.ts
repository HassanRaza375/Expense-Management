import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The admin's repository is the only place the panel reads the database. A query there may select an account's id, email, name, role and state, the sync cursor's counters and the
// PROJECTION columns of records. These guards keep a later change from selecting what the admin must never see: the stored document (notes, names, file names, the Vault),
// passwords, tokens, the profile photo.
const src = readFileSync(fileURLToPath(new URL("../server/utils/adminRepo.ts", import.meta.url)), "utf8");

describe("adminRepo never reads private content", () => {
  it("the user select is explicit and holds no password, token, photo or session secret", () => {
    const sel = src.slice(src.indexOf("const USER_SELECT"), src.indexOf("} as const", src.indexOf("const USER_SELECT")));
    expect(sel).toMatch(/email: true/);
    expect(sel).not.toMatch(/password|token|image|avatar|secret|scope|idToken/i);
  });
  it("record reads select projection columns only and never `data`", () => {
    const sel = src.slice(src.indexOf("syncDoc.findMany"), src.indexOf("syncDoc.findMany") + 600);
    expect(sel).toMatch(/select:/);
    expect(sel).not.toMatch(/\bdata\s*:\s*true/);
    for (const col of ["dayKey", "amountMinor", "kind", "categoryId", "accountId", "sizeBytes"]) expect(sel).toContain(col);
  });
  it("nothing in the file selects `data: true`, a password, a token or the sessions' tokens", () => {
    expect(src).not.toMatch(/\bdata\s*:\s*true/);
    expect(src).not.toMatch(/password\s*:\s*true|token\s*:\s*true|accessToken|refreshToken|idToken/);
    expect(src).not.toMatch(/\.account\.find|db\(\)\.account\b/); // the sign-in methods table holds password hashes
    expect(src).not.toMatch(/\$queryRaw|\$executeRaw/); // no raw SQL
  });
});
