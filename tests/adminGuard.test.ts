import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin guard and the privacy rule. The guard: everything that is not a signed-in, enabled super admin is a 404 (as if the route did not exist), the role comes from the
// session's user row only, and the same-site check comes after the role is known. The privacy rule: nothing in the admin code can read a record's content, a password or a token.
let current: unknown = null;
let throwing = false;
vi.mock("../server/utils/auth", () => ({
  useAuth: () => ({
    api: {
      getSession: async () => {
        if (throwing) throw new Error("db down");
        return current;
      },
    },
  }),
}));

const { requireSuperAdmin } = await import("../server/utils/session");

let syncOn = true;
beforeEach(() => {
  syncOn = true;
  current = null;
  throwing = false;
  process.env.DATABASE_URL = "postgres://u:p@blocked.invalid:5432/db";
  vi.stubGlobal("useRuntimeConfig", () => ({ public: { syncEnabled: syncOn } }));
});
afterEach(() => vi.unstubAllGlobals());

const event = (headers: Record<string, string> = {}, method = "GET"): H3Event => ({ node: { req: { headers: { host: "app.example.test", ...headers } } }, method, path: "/api/admin/users" }) as unknown as H3Event;
const user = (over: Record<string, unknown> = {}) => ({ user: { id: "u", email: "u@example.test", name: "U", role: "user", disabled: false, ...over }, session: {} });
const outcome = async (e: H3Event) => {
  try {
    return { ok: (await requireSuperAdmin(e)).id };
  } catch (err) {
    const x = err as { statusCode?: number; data?: { error?: string } };
    return { status: x.statusCode, error: x.data?.error };
  }
};
const NOT_FOUND = { status: 404, error: "not_found" };

describe("requireSuperAdmin", () => {
  it("lets a signed-in, enabled super admin through", async () => {
    current = user({ id: "root", role: "superadmin" });
    expect(await outcome(event())).toEqual({ ok: "root" });
  });

  it("signed out, an ordinary user and a disabled super admin all get the same 404", async () => {
    expect(await outcome(event())).toEqual(NOT_FOUND);
    current = user({ role: "user" });
    expect(await outcome(event())).toEqual(NOT_FOUND);
    current = user({ role: "superadmin", disabled: true });
    expect(await outcome(event())).toEqual(NOT_FOUND);
  });

  it("a forged role or user in the request changes nothing: the role is the session user's", async () => {
    current = user({ role: "user" });
    for (const h of [{ "x-role": "superadmin" }, { "x-user-role": "superadmin" }, { role: "superadmin" }, { cookie: "role=superadmin; admin=1" }, { authorization: "Bearer admin" }, { "x-hisaab-account": "root" }]) {
      expect(await outcome(event(h)), JSON.stringify(h)).toEqual(NOT_FOUND);
    }
  });

  it("accounts switched off, or a failing session lookup, is a 404 too (nothing is revealed)", async () => {
    current = user({ id: "root", role: "superadmin" });
    syncOn = false;
    expect(await outcome(event())).toEqual(NOT_FOUND);
    syncOn = true;
    throwing = true;
    expect(await outcome(event())).toEqual(NOT_FOUND);
  });

  it("a state-changing request from another site is refused (403) only AFTER the role is known: a stranger still sees a 404", async () => {
    const cross = { origin: "https://evil.example" };
    current = user({ id: "root", role: "superadmin" });
    expect(await outcome(event(cross, "DELETE"))).toEqual({ status: 403, error: "forbidden_origin" });
    expect(await outcome(event({ origin: "https://app.example.test" }, "DELETE"))).toEqual({ ok: "root" });
    current = user({ role: "user" });
    expect(await outcome(event(cross, "DELETE"))).toEqual(NOT_FOUND);
    current = null;
    expect(await outcome(event(cross, "DELETE"))).toEqual(NOT_FOUND);
  });
});

describe("the admin cannot read private content", () => {
  const server = fileURLToPath(new URL("../server", import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (n === "generated" ? [] : statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
  const adminFiles = walk(server).filter((f) => /[\\/]admin/i.test(f) || /adminRepo|adminService|adminTypes|adminRoutes/.test(f));
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("there are admin files to check", () => {
    expect(adminFiles.length).toBeGreaterThanOrEqual(14);
  });

  it("no admin file selects a record's content, a password, a token or a session", () => {
    for (const f of adminFiles) {
      const src = code(f);
      expect(src, f).not.toMatch(/\bdata:\s*true|select:\s*\{[^}]*\bdata\b/);
      expect(src, f).not.toMatch(/\bpassword\b|accessToken|refreshToken|idToken|\btoken\b/i);
      expect(src, f).not.toMatch(/session\.find|account\.find|verification\./); // sessions are only ever REMOVED (deleteMany), never read
      expect(src, f).not.toMatch(/\$queryRaw|\$executeRaw|Unsafe/);
    }
  });

  it("the one query that reads sync records names its columns, and they are the projection columns", () => {
    const repo = code(path.join(server, "utils/adminRepo.ts"));
    const reads = [...repo.matchAll(/syncDoc\.(findMany|findFirst|findUnique)\(/g)];
    expect(reads).toHaveLength(1);
    expect(repo).toMatch(/select:\s*\{ userId: true, collection: true, dayKey: true, amountMinor: true, kind: true, categoryId: true, accountId: true, parentId: true, sizeBytes: true \}/);
    const userSelect = /const USER_SELECT = \{([\s\S]*?)\} satisfies/.exec(repo)![1]!;
    expect(userSelect.match(/(\w+):/g)!.map((x) => x.slice(0, -1)).sort()).toEqual(["_count", "bytes", "createdAt", "disabled", "email", "emailVerified", "id", "name", "role", "select", "select", "syncCursor", "syncDocs", "updatedAt", "where", "deletedAt"].sort());
  });

  it("every admin route is read-only except the user actions, each of which is audited by the service", () => {
    const routes = adminFiles.filter((f) => /api[\\/]admin/.test(f));
    expect(routes.length).toBe(11);
    const service = code(path.join(server, "utils/adminService.ts"));
    for (const fn of ["updateUser", "deleteUser", "sendResetEmail"]) expect(service.slice(service.indexOf(`export async function ${fn}`)), fn).toMatch(/repo\.audit\(/);
    const writers = routes.filter((f) => /\.(patch|delete|post|put)\.ts$/.test(f)).map((f) => path.basename(f));
    expect(writers.sort()).toEqual(["[id].delete.ts", "[id].patch.ts", "reset-email.post.ts"]);
  });
});
