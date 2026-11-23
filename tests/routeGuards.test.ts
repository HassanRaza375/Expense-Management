import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static guards over every server route: who may call it, and where the user comes from. The live checks (scripts/live/account.mjs) prove the behaviour against a
// real database; these keep a later change from quietly removing a guard.
const apiDir = fileURLToPath(new URL("../server/api", import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const rel = (f: string) => path.relative(apiDir, f).replace(/\\/g, "/");
const files = walk(apiDir);

// the routes that need no signed-in user, each with the reason
const PUBLIC: Record<string, string> = {
  "health.get.ts": "reports whether the server is up; no data",
  "[...].ts": "the JSON 404 for any unknown /api/ path",
  "auth/[...all].ts": "Better Auth's own routes (sign up, sign in, ...): it does its own checks, rate limits and origin checks",
  "account/status.get.ts": "which sign-in options exist (booleans only)",
  "account/session.get.ts": "answers 200 with a null profile when signed out (a browser logs every 4xx as an error); it applies the same flag, origin and session checks",
};

describe("every route is either listed as public or demands a signed-in user", () => {
  it("each non-public route calls requireUser first", () => {
    const routes = files.map(rel).filter((f) => !(f in PUBLIC));
    // the one route that may answer a signed-out caller does the whole check itself, first
    expect(readFileSync(path.join(apiDir, "account/session.get.ts"), "utf8")).toMatch(/apiHandler\(async \(event\) => \{\s*const user = await optionalUser\(event\)/);
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const f of routes) {
      const src = readFileSync(path.join(apiDir, f), "utf8");
      expect(src, f).toMatch(/await requireUser\(event\)/);
      // nothing may happen before the user is known: requireUser is the first statement of the handler
      const afterHandler = src.slice(src.indexOf("apiHandler(async (event) => {"));
      expect(afterHandler.replace(/^[^\n]*\n\s*/, "").startsWith("const user = await requireUser(event)"), `${f}: requireUser must be the first statement`).toBe(true);
    }
  });

  it("the public list only names files that exist (no stale entries)", () => {
    const names = new Set(files.map(rel));
    for (const f of Object.keys(PUBLIC)) expect(names.has(f), f).toBe(true);
  });

  it("every route that is not the health check or the JSON 404 is behind the sync flag", () => {
    for (const f of files.map(rel)) {
      if (f === "health.get.ts" || f === "[...].ts") continue;
      const src = readFileSync(path.join(apiDir, f), "utf8");
      expect(/requireEnabled\(event\)|requireUser\(event\)|optionalUser\(event\)/.test(src), f).toBe(true); // requireUser and optionalUser call requireEnabled first
    }
    const session = readFileSync(fileURLToPath(new URL("../server/utils/session.ts", import.meta.url)), "utf8");
    expect(session.indexOf("requireEnabled(event)")).toBeGreaterThan(-1);
    expect(session.indexOf("requireEnabled(event)")).toBeLessThan(session.indexOf("getSession"));
    expect(session.indexOf("requireSameOrigin(event)")).toBeLessThan(session.indexOf("getSession"));
  });
});

describe("no route takes the user from the caller", () => {
  it("no route reads a user id, role or account from the query string, the path, a header or the body", () => {
    for (const f of files.map(rel)) {
      const src = readFileSync(path.join(apiDir, f), "utf8");
      expect(src, f).not.toMatch(/getQuery|getRouterParam|getValidatedQuery|event\.context\.params|getRequestHeader\(event, ["'](x-user|x-role)/i);
      expect(src, f).not.toMatch(/body\.(userId|user_id|role|id|email)\b/);
    }
  });

  it("the only body a route reads is `confirm` (account deletion), and the photo bytes", () => {
    const reads = files.map(rel).filter((f) => /readSmallJson|readLimitedBytes|readBody|readRawBody/.test(readFileSync(path.join(apiDir, f), "utf8")));
    expect(reads.sort()).toEqual(["account/avatar.post.ts", "account/index.delete.ts"]);
    expect(readFileSync(path.join(apiDir, "account/index.delete.ts"), "utf8")).toMatch(/body\.confirm/);
  });

  it("requireUser takes the user from Better Auth's session only", () => {
    const session = readFileSync(fileURLToPath(new URL("../server/utils/session.ts", import.meta.url)), "utf8");
    expect(session).toMatch(/auth\.api\.getSession\(/);
    expect(session).not.toMatch(/getQuery|readBody|getRouterParam/);
  });
});

describe("the repository the account routes use is scoped to the session's user", () => {
  it("every query in accountRepo.ts names the user by the id it was given (never a global where)", () => {
    const src = readFileSync(fileURLToPath(new URL("../server/utils/accountRepo.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/deleteMany|updateMany/);
    expect(src).toMatch(/db\.user\.delete\(\{ where: \{ id \} \}\)/);
    expect(src).toMatch(/db\.user\.update\(\{ where: \{ id \}/);
  });
});
