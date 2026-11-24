import { test, expect } from "./fixtures";

// The server routes, against the production build. 3011 runs with the sync flag off (today's app), 3013 with the SERVER flag on and a database that cannot resolve.
const OFF = "http://localhost:3011";
const ON = "http://localhost:3013";

test.describe("flag off (production today)", () => {
  test("/api/health answers 200 and never touches a database", async ({ request }) => {
    const r = await request.get(`${OFF}/api/health`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("application/json");
    expect(await r.json()).toEqual({ ok: true, sync: false, database: "not_checked" });
  });

  test("an unknown /api/ path is a JSON 404, even when the client asks for HTML", async ({ request }) => {
    for (const p of ["/api/nope", "/api/nope/deeper", "/api/health/extra"]) {
      const r = await request.get(`${OFF}${p}`, { headers: { accept: "text/html" } });
      expect(r.status(), p).toBe(404);
      expect(r.headers()["content-type"], p).toContain("application/json");
      expect(await r.json(), p).toEqual({ error: "not_found" });
    }
  });

  test("API answers are never cached", async ({ request }) => {
    for (const p of ["/api/health", "/api/nope"]) expect((await request.get(`${OFF}${p}`)).headers()["cache-control"], p).toMatch(/no-store/);
  });
});

test.describe("flag on, database unreachable", () => {
  test("/api/health says the database is down, with no details", async ({ request }) => {
    const r = await request.get(`${ON}/api/health`);
    expect(r.status()).toBe(503);
    const body = await r.json();
    expect(body).toEqual({ ok: false, sync: true, database: "down" });
    expect(JSON.stringify(body)).not.toMatch(/blocked|invalid|postgres|5432/i);
  });

  test("an unknown /api/ path is still a JSON 404", async ({ request }) => {
    const r = await request.get(`${ON}/api/nope`);
    expect(r.status()).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
});

test("the service worker never handles /api/ (a navigation to it is not answered with the app shell)", async ({ page }) => {
  await page.goto("/dashboard");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const result = await page.evaluate(async () => {
    const r = await fetch("/api/health", { headers: { accept: "text/html" } });
    return { status: r.status, type: r.headers.get("content-type") ?? "", body: await r.text() };
  });
  expect(result.type).toContain("application/json");
  expect(result.body).not.toContain("<!DOCTYPE");
  expect(JSON.parse(result.body).sync).toBe(false);
});
