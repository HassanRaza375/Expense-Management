import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cfg = readFileSync(fileURLToPath(new URL("../nuxt.config.ts", import.meta.url)), "utf8");

// nuxt.config.ts is checked as text: these settings are load-bearing decisions (docs/DECISIONS.md) and a silent change would break offline use or the cutover.
describe("nuxt.config.ts keeps its load-bearing decisions", () => {
  it("is a single-page app (D1)", () => {
    expect(cfg).toMatch(/ssr:\s*false/);
  });

  it("does not register the pure code as global auto-imports, nor components by directory (D4)", () => {
    expect(cfg).toMatch(/imports:\s*\{\s*scan:\s*false\s*\}/);
    expect(cfg).toMatch(/components:\s*\{\s*dirs:\s*\[\]\s*\}/);
  });

  it("keeps the worker identity of the old app: prompt-to-reload, scope and manifest id (D6)", () => {
    expect(cfg).toMatch(/registerType:\s*"prompt"/);
    expect(cfg).toMatch(/id:\s*"\/"/);
    expect(cfg).toMatch(/scope:\s*"\/"/);
    expect(cfg).toMatch(/start_url:\s*"\/"/);
  });

  it("the service worker never handles /api/ and falls back to the precached shell", () => {
    expect(cfg).toMatch(/navigateFallback:\s*"\/"/);
    expect(cfg).toMatch(/navigateFallbackDenylist:\s*\[\/\^\\\/api\\\/\/\]/);
  });

  it("prerenders the shell so the worker has something to fall back to offline", () => {
    expect(cfg).toMatch(/prerender:\s*\{\s*routes:\s*\["\/"\]/);
  });

  it("does not put a data-theme on <html> through the head manager (it would override the saved theme)", () => {
    expect(cfg).not.toMatch(/"data-theme":/);
  });

  it("never lets a response under /api/ be cached", () => {
    expect(cfg).toMatch(/"\/api\/\*\*":\s*\{\s*headers:\s*\{\s*"cache-control":\s*"no-store"/);
  });
});
