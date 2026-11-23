import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import { BUCKETS, consume, limit, type LimitStore } from "../server/utils/rateLimit";

const memory = (): LimitStore & { rows: Map<string, { count: number; start: number }> } => {
  const rows = new Map<string, { count: number; start: number }>();
  return {
    rows,
    get: async (k) => rows.get(k) ?? null,
    begin: async (k, start) => void rows.set(k, { count: 1, start }),
    bump: async (k) => void (rows.get(k)!.count += 1),
  };
};
const event = () => createEvent(new IncomingMessage(new Socket()), new ServerResponse(new IncomingMessage(new Socket())));
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { statusCode: number; data?: { error: string } }) => `${e.statusCode}:${e.data?.error}`);

describe("the fixed-window counter", () => {
  const bucket = { max: 3, windowSec: 60 };
  it("allows `max` requests in a window, then refuses with the seconds to wait", async () => {
    const s = memory();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(await consume(s, "k", bucket, t + i * 1000)).toEqual({ allowed: true });
    expect(await consume(s, "k", bucket, t + 10_000)).toEqual({ allowed: false, retryAfterSec: 50 });
    expect(s.rows.get("k")!.count).toBe(3); // a refused request is not counted
  });
  it("starts a new window when the old one is over, and never answers less than 1 second", async () => {
    const s = memory();
    for (let i = 0; i < 3; i++) await consume(s, "k", bucket, 0);
    expect(await consume(s, "k", bucket, 59_999)).toEqual({ allowed: false, retryAfterSec: 1 });
    expect(await consume(s, "k", bucket, 60_000)).toEqual({ allowed: true });
    expect(s.rows.get("k")).toEqual({ count: 1, start: 60_000 });
  });
  it("counts each key on its own", async () => {
    const s = memory();
    for (let i = 0; i < 3; i++) await consume(s, "a", bucket, 0);
    expect((await consume(s, "a", bucket, 1)).allowed).toBe(false);
    expect((await consume(s, "b", bucket, 1)).allowed).toBe(true);
  });
});

describe("limit() on a request", () => {
  it("is keyed by the signed-in account and bucket (never an address), answers 429 rate_limited and sets Retry-After", async () => {
    const s = memory();
    const e = event();
    const now = () => 5_000;
    for (let i = 0; i < BUCKETS["receipt.cleanup"].max; i++) await limit(e, "u1", "receipt.cleanup", () => s, now);
    expect([...s.rows.keys()]).toEqual(["api:receipt.cleanup:u1"]);
    expect(await code(limit(e, "u1", "receipt.cleanup", () => s, now))).toBe("429:rate_limited");
    expect(e.node.res.getHeader("retry-after")).toBe("60");
    await limit(e, "u2", "receipt.cleanup", () => s, now); // another account has its own budget
    await limit(e, "u1", "general", () => s, now); // and so does another bucket
  });

  it("lets the request go on when the limiter's own store fails, logging only the error's name and code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: LimitStore = { get: async () => Promise.reject(Object.assign(new Error("connect postgres://user:secret@host/db"), { code: "ECONNRESET" })), begin: async () => undefined, bump: async () => undefined };
    await expect(limit(event(), "u1", "general", () => broken)).resolves.toBeUndefined();
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("Error ECONNRESET");
    expect(line).not.toMatch(/secret|postgres/);
    spy.mockRestore();
  });

  it("budgets are sane: a normal sync loop cannot reach them, a clean-up or an account delete is rare", () => {
    expect(BUCKETS["sync.push"].max).toBeGreaterThanOrEqual(60); // the engine starts a run at most every 1.5 s
    expect(BUCKETS["receipt.cleanup"].max).toBeLessThanOrEqual(10);
    expect(BUCKETS["account.delete"].max).toBeLessThanOrEqual(5);
    for (const b of Object.values(BUCKETS)) expect(b.max).toBeGreaterThan(0);
  });
});
