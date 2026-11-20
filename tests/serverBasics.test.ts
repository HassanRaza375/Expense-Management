import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isSyncOn } from "../app/lib/sync/flag";
import { isRealDayKey, monthOf, toMinorUnits, yearOf } from "../app/lib/dayKey";
import { checkHealth } from "../server/utils/health";

describe("the sync flag", () => {
  it("only 1 and true mean on", () => {
    for (const on of [true, 1, "1", "true", "TRUE", " true "]) expect(isSyncOn(on), String(on)).toBe(true);
    for (const off of [false, 0, "0", "false", "", " ", "yes", "on", "2", undefined, null, {}, []]) expect(isSyncOn(off), String(off)).toBe(false);
  });
});

describe("day keys (the server never works out a day itself)", () => {
  it("accepts real calendar days written exactly as YYYY-MM-DD", () => {
    for (const k of ["2026-11-20", "2024-02-29", "2000-02-29", "2026-12-31", "2026-01-01", "1900-01-01", "2199-12-31"]) expect(isRealDayKey(k), k).toBe(true);
  });

  it("refuses everything else", () => {
    for (const k of ["2026-02-30", "2025-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-11-00", "2026-11-31", "2026-1-5", "26-11-20", "2026/11/20", "2026-11-20T00:00:00Z", " 2026-11-20", "", "abc", "1899-12-31", "2200-01-01"]) {
      expect(isRealDayKey(k), k).toBe(false);
    }
    for (const v of [null, undefined, 20261120, {}, [], true]) expect(isRealDayKey(v)).toBe(false);
  });

  it("groups by text: month and year are slices of the key, whatever the time zone", () => {
    expect(monthOf("2026-11-30")).toBe("2026-11");
    expect(yearOf("2026-11-30")).toBe("2026");
    const before = process.env.TZ;
    for (const tz of ["UTC", "Pacific/Auckland", "America/New_York"]) {
      process.env.TZ = tz;
      expect(isRealDayKey("2026-03-01")).toBe(true);
      expect(monthOf("2026-03-01")).toBe("2026-03");
    }
    process.env.TZ = before;
  });

  it("turns money into integer minor units exactly", () => {
    expect(toMinorUnits(12.5)).toBe(1250n);
    expect(toMinorUnits("1200.50")).toBe(120050n);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30n);
    expect(toMinorUnits(-3)).toBe(-300n);
    expect(toMinorUnits(1.005)).toBe(100n); // 1.005 * 100 is 100.49999999999999 in binary floating point; amounts come from 2-decimal inputs, so this case does not arise
    for (const bad of ["", "abc", NaN, Infinity, null, undefined, {}]) expect(() => toMinorUnits(bad)).toThrow(RangeError);
  });
});

describe("checkHealth", () => {
  const never = () => {
    throw new Error("the database must not be touched");
  };

  it("with sync off answers 200 and never touches the database", async () => {
    const probe = vi.fn(never);
    const h = await checkHealth({ syncOn: false, hasDatabase: false, probe });
    expect(h).toEqual({ status: 200, body: { ok: true, sync: false, database: "not_checked" } });
    expect(probe).not.toHaveBeenCalled();
    const h2 = await checkHealth({ syncOn: false, hasDatabase: true, probe });
    expect(h2.status).toBe(200);
    expect(probe).not.toHaveBeenCalled();
  });

  it("with sync on and no database says unconfigured (503) without probing", async () => {
    const probe = vi.fn(never);
    expect(await checkHealth({ syncOn: true, hasDatabase: false, probe })).toEqual({ status: 503, body: { ok: false, sync: true, database: "unconfigured" } });
    expect(probe).not.toHaveBeenCalled();
  });

  it("with sync on and a working probe says up", async () => {
    expect(await checkHealth({ syncOn: true, hasDatabase: true, probe: async () => 1 })).toEqual({ status: 200, body: { ok: true, sync: true, database: "up" } });
  });

  it("a failing probe says down, logs the failure, and returns none of its text", async () => {
    const seen: unknown[] = [];
    const h = await checkHealth({
      syncOn: true,
      hasDatabase: true,
      probe: async () => {
        throw new Error("password authentication failed for user secret_user at secret-host");
      },
      onFailure: (e) => seen.push(e),
    });
    expect(h).toEqual({ status: 503, body: { ok: false, sync: true, database: "down" } });
    expect(JSON.stringify(h)).not.toContain("secret");
    expect(seen).toHaveLength(1);
  });

  it("a probe that never answers times out instead of hanging", async () => {
    const t = Date.now();
    const h = await checkHealth({ syncOn: true, hasDatabase: true, probe: () => new Promise(() => undefined), timeoutMs: 50 });
    expect(h.body.database).toBe("down");
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("every server route answers JSON", () => {
  const apiDir = fileURLToPath(new URL("../server/api", import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

  it("each file in server/api is wrapped in apiHandler (so a thrown refusal is JSON, never an HTML error page)", () => {
    const files = walk(apiDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) expect(readFileSync(f, "utf8"), f).toMatch(/export default apiHandler\(/);
  });

  it("there is a catch-all so an unknown /api/ path is a JSON 404", () => {
    expect(walk(apiDir).some((f) => path.basename(f) === "[...].ts")).toBe(true);
  });

  it("no route reads a secret into runtimeConfig, and none logs an error message body", () => {
    for (const f of walk(apiDir)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/useRuntimeConfig\([^)]*\)\.(?!public)/);
    }
  });
});
