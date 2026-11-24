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
      // nothing may happen before the caller is known: the guard is the first statement of the handler (admin routes: the super-admin guard, which answers 404 to everyone else)
      const afterHandler = src.slice(src.indexOf("apiHandler(async (event) => {")).replace(/^[^\n]*\n\s*/, "");
      if (f.startsWith("admin/")) expect(/^(const admin = )?await requireSuperAdmin\(event\)/.test(afterHandler), `${f}: requireSuperAdmin must be the first statement`).toBe(true);
      else expect(afterHandler.startsWith("const user = await requireUser(event)"), `${f}: requireUser must be the first statement`).toBe(true);
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
      expect(/requireEnabled\(event\)|requireUser\(event\)|optionalUser\(event\)|requireSuperAdmin\(event\)/.test(src), f).toBe(true); // requireUser and optionalUser call requireEnabled first
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
      // the receipt routes take the RECEIPT's id from the path (never a user: the owner is the session's, and the service looks the record up inside that user's own records)
      const checked = (f.startsWith("receipts/") || f.startsWith("admin/")) ? src.replace(/getRouterParam\(event, "id"\)/g, "").replace(/import \{ getRouterParam \} from "h3";/, "") : src;
      expect(checked, f).not.toMatch(/getQuery|getRouterParam|getValidatedQuery|event\.context\.params|getRequestHeader\(event, ["'](x-user|x-role)/i);
      expect(src, f).not.toMatch(/body\.(userId|user_id|role|id|email)\b/);
    }
  });

  it("the only bodies a route reads are `confirm` (account deletion), the photo bytes, and the sync operations (which carry records, never a user)", () => {
    const reads = files.map(rel).filter((f) => /readSmallJson|readLimitedBytes|readBody|readRawBody|readJsonLimited/.test(readFileSync(path.join(apiDir, f), "utf8")));
    expect(reads.sort()).toEqual(["account/avatar.post.ts", "account/index.delete.ts", "admin/users/[id].delete.ts", "admin/users/[id].patch.ts", "receipts/[id].put.ts", "receipts/cleanup.post.ts", "sync/pull.post.ts", "sync/push.post.ts"]);
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
    // the only bulk statement is the account's own API request counters, matched on the account's id
    expect(src.match(/deleteMany|updateMany/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/db\.rateLimit\.deleteMany\(\{ where: \{ key: \{ startsWith: "api:", endsWith: `:\$\{id\}` \} \} \}\)/);
    expect(src).toMatch(/db\.user\.delete\(\{ where: \{ id \} \}\)/);
    expect(src).toMatch(/db\.user\.update\(\{ where: \{ id \}/);
  });
});

describe("every route has an authorization check written for it, and a request budget", () => {
  it("scripts/live/authzTable.mjs lists every route file (a new route needs a row, and so an authorization check in the live run)", async () => {
    const { ROUTES } = (await import("../scripts/live/authzTable.mjs")) as { ROUTES: Array<{ file: string; access: string }> };
    expect(ROUTES.map((r) => r.file).sort()).toEqual(files.map(rel).sort());
    for (const r of ROUTES) expect(["public", "user", "admin"]).toContain(r.access);
    // the table and the rules in this file agree: the public rows are the PUBLIC list, the admin rows are the files under admin/
    expect(ROUTES.filter((r) => r.access === "public").map((r) => r.file).sort()).toEqual(Object.keys(PUBLIC).sort());
    expect(ROUTES.filter((r) => r.access === "admin").map((r) => r.file).sort()).toEqual(files.map(rel).filter((f) => f.startsWith("admin/")).sort());
  });

  it("both guards count the request against the account's general budget, and the costly routes name a stricter bucket", () => {
    const session = readFileSync(fileURLToPath(new URL("../server/utils/session.ts", import.meta.url)), "utf8");
    expect(session.match(/await limit\(event, user\.id, "general"\)/g)).toHaveLength(2); // optionalUser (so requireUser) and requireSuperAdmin
    const BUCKET: Record<string, string> = {
      "sync/push.post.ts": "sync.push",
      "sync/pull.post.ts": "sync.pull",
      "receipts/[id].put.ts": "receipt.put",
      "receipts/[id].get.ts": "receipt.get",
      "receipts/cleanup.post.ts": "receipt.cleanup",
      "account/avatar.post.ts": "avatar.write",
      "account/avatar.delete.ts": "avatar.write",
      "account/index.delete.ts": "account.delete",
      "admin/users/[id].patch.ts": "admin.write",
      "admin/users/[id].delete.ts": "admin.write",
      "admin/users/[id]/reset-email.post.ts": "admin.write",
    };
    for (const [f, bucket] of Object.entries(BUCKET)) {
      const src = readFileSync(path.join(apiDir, f), "utf8");
      const who = f.startsWith("admin/") ? "admin" : "user";
      expect(src, f).toContain(`await limit(event, ${who}.id, "${bucket}");`);
      // the budget is spent right after the guard, before any body is read or any work is done
      const body = src.slice(src.indexOf("apiHandler("));
      expect(body.indexOf("await limit("), f).toBeLessThan(body.search(/read(SmallJson|LimitedBytes|JsonLimited)\(|run\(/));
    }
    // every state-changing, non-public route that is not in the list above is cheap and is covered by the general budget only
    const writers = files.map(rel).filter((f) => /\.(post|put|patch|delete)\.ts$/.test(f) && !(f in PUBLIC));
    expect(writers.filter((f) => !(f in BUCKET))).toEqual([]);
  });
});
