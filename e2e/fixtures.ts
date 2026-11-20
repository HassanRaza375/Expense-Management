import { test as base, expect, type BrowserContext } from "@playwright/test";

// Every browser test starts from this `test`. It does three things for free:
//   1. forbids the real services: any request that is not to this machine is blocked and recorded (a test can never depend on the internet by accident);
//   2. records every page error and console error/warning;
//   3. fails the test at the end if either happened (a test that expects errors says so with `allowConsole`).
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface Guard {
  blocked: string[];
  consoleProblems: string[];
  pageErrors: string[];
  /** an expected console message (a regex) that must not fail the test */
  allowConsole(re: RegExp): void;
}

/** Blocks every request that is not to this machine, and records it. Used by the `guard` fixture and by e2e/services.spec.ts. */
export async function forbidRealServices(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || LOCAL.has(url.hostname)) return route.fallback();
    blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  return blocked;
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context, page }, use) => {
      const blocked = await forbidRealServices(context);
      const consoleProblems: string[] = [];
      const pageErrors: string[] = [];
      const allowed: RegExp[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") consoleProblems.push(`[${m.type()}] ${m.text()}`);
      });
      page.on("pageerror", (e) => pageErrors.push(e.message));
      const guard: Guard = { blocked, consoleProblems, pageErrors, allowConsole: (re) => void allowed.push(re) };
      await use(guard);
      expect(blocked, "a request left this machine").toEqual([]);
      expect(pageErrors, "page errors").toEqual([]);
      expect(consoleProblems.filter((m) => !allowed.some((re) => re.test(m))), "console errors or warnings").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
