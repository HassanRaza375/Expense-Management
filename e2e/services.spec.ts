import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { forbidRealServices } from "./fixtures";

// The guard that keeps every other browser test off the internet is itself tested here (it uses the plain Playwright `test`, because it must look at the blocked list).
base("the guard blocks requests to real services and lets local ones through", async ({ page, context }) => {
  const blocked = await forbidRealServices(context);
  await page.goto("/settings");
  const results = await page.evaluate(async () => {
    const tryFetch = (url: string) => fetch(url, { mode: "no-cors" }).then(() => "reached", () => "blocked");
    return {
      cloudinary: await tryFetch("https://res.cloudinary.com/demo/image/upload/sample.jpg"),
      aiven: await tryFetch("https://example-project.aivencloud.com:12345/"),
      google: await tryFetch("https://accounts.google.com/"),
      local: await fetch("/manifest.webmanifest").then((r) => r.ok, () => false),
    };
  });
  expect(results.cloudinary).toBe("blocked");
  expect(results.aiven).toBe("blocked");
  expect(results.google).toBe("blocked");
  expect(results.local).toBe(true);
  expect(blocked.map((b) => new URL(b.split(" ")[1]!).hostname).sort()).toEqual(["accounts.google.com", "example-project.aivencloud.com", "res.cloudinary.com"]);
});

base("the test servers are configured with an unreachable database and blank keys", () => {
  const cfg = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
  expect(cfg).toContain("postgres://blocked.invalid");
  for (const name of ["BETTER_AUTH_SECRET", "CLOUDINARY_API_SECRET", "CLOUDINARY_URL", "GOOGLE_CLIENT_SECRET", "ADMIN_SEED_PASSWORD"]) {
    expect(cfg).toMatch(new RegExp(`${name}: ""`));
  }
});
