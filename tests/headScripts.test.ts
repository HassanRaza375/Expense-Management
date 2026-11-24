import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { EARLY_THEME_SCRIPT, LEGACY_HASH_SCRIPT } from "~/lib/headScripts";

// The two inline scripts run in the browser before the app. Here they run in a tiny fake window.
function run(script: string, win: Record<string, unknown>) {
  runInNewContext(script, win);
  return win;
}

describe("LEGACY_HASH_SCRIPT: old hash addresses become real paths", () => {
  const fake = (hash: string) => {
    const calls: string[] = [];
    return { win: { location: { hash }, history: { replaceState: (_s: unknown, _t: string, url: string) => calls.push(url) } }, calls };
  };

  it("turns /#/expenses into /expenses", () => {
    const { win, calls } = fake("#/expenses");
    run(LEGACY_HASH_SCRIPT, win);
    expect(calls).toEqual(["/expenses"]);
  });

  it("keeps deep paths and their parameters", () => {
    const { win, calls } = fake("#/accounts/abc-123");
    run(LEGACY_HASH_SCRIPT, win);
    expect(calls).toEqual(["/accounts/abc-123"]);
    const q = fake("#/expenses?cycle=all&account=none");
    run(LEGACY_HASH_SCRIPT, q.win);
    expect(q.calls).toEqual(["/expenses?cycle=all&account=none"]);
  });

  it("leaves a hash that is not a path alone", () => {
    for (const hash of ["", "#", "#top", "#section-2"]) {
      const { win, calls } = fake(hash);
      run(LEGACY_HASH_SCRIPT, win);
      expect(calls, hash).toEqual([]);
    }
  });

  it("never throws when the browser objects are missing or fail", () => {
    expect(() => run(LEGACY_HASH_SCRIPT, {})).not.toThrow();
    expect(() => run(LEGACY_HASH_SCRIPT, { location: { hash: "#/x" }, history: { replaceState: () => { throw new Error("no"); } } })).not.toThrow();
  });
});

describe("EARLY_THEME_SCRIPT: the saved theme before first paint", () => {
  const themeFor = (stored: string | null, fail = false) => {
    let theme = "";
    const win = {
      localStorage: { getItem: (k: string) => { if (fail) throw new Error("blocked"); return k === "hisaab:settings" ? stored : null; } },
      document: { documentElement: { setAttribute: (_n: string, v: string) => { theme = v; } } },
      JSON,
    };
    run(EARLY_THEME_SCRIPT, win);
    return theme;
  };

  it("applies light when the saved setting is light", () => {
    expect(themeFor(JSON.stringify({ theme: "light" }))).toBe("light");
  });

  it("defaults to dark for dark, missing, broken or unreadable settings", () => {
    expect(themeFor(JSON.stringify({ theme: "dark" }))).toBe("dark");
    expect(themeFor(null)).toBe("dark");
    expect(themeFor("{broken")).toBe("");
    expect(themeFor(JSON.stringify({ theme: "purple" }))).toBe("dark");
    expect(themeFor(null, true)).toBe("");
  });

  it("reads the same key the app stores its settings under", () => {
    expect(EARLY_THEME_SCRIPT).toContain("hisaab:settings");
  });
});
