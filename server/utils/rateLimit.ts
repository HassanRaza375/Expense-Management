// A per-account rate limit for the API routes (Better Auth limits its own sign-in routes). A fixed window per (account, bucket), counted in the database table Better Auth
// already uses for its limits (`RateLimit`; our keys start with `api:` so they never meet its keys), so every serverless instance shares one count.
//   - The caller is the SIGNED-IN ACCOUNT (the session's user id), never an address the client can choose.
//   - Too many requests: 429 `{ error: "rate_limited" }` with `Retry-After`; the sync engine and the pages already treat that as "try again later".
//   - If the limiter's own database call fails, the request goes on (fail open, logged by error code only): the same database is needed to do the work, and a limiter must never be
//     the thing that stops a person from reaching their own data.
import type { H3Event } from "h3";
import { setHeader } from "h3";
import { jsonError } from "./api";
import { useDb } from "./db";

export interface LimitStore {
  /** The window of this key, or null. `start` is when the window began (ms). */
  get(key: string): Promise<{ count: number; start: number } | null>;
  /** Starts a new window of 1 request. */
  begin(key: string, start: number): Promise<void>;
  /** Counts one more request in the current window. */
  bump(key: string): Promise<void>;
}

export interface Bucket {
  /** requests allowed per window */
  max: number;
  /** the window, in seconds */
  windowSec: number;
}

/** The general budget of one account (everything it calls together), and stricter budgets for the routes that cost more. All per minute unless stated. */
export const BUCKETS = {
  general: { max: 600, windowSec: 60 },
  "sync.push": { max: 90, windowSec: 60 },
  "sync.pull": { max: 180, windowSec: 60 },
  "receipt.put": { max: 40, windowSec: 60 },
  "receipt.get": { max: 120, windowSec: 60 },
  "receipt.cleanup": { max: 6, windowSec: 60 },
  "avatar.write": { max: 12, windowSec: 60 },
  "account.delete": { max: 5, windowSec: 600 },
  "admin.write": { max: 60, windowSec: 60 },
} as const satisfies Record<string, Bucket>;
export type BucketName = keyof typeof BUCKETS;

/** Pure decision: may this request go ahead, and for how many more seconds is the answer no. Counts the request when it is allowed. */
export async function consume(store: LimitStore, key: string, bucket: Bucket, now: number): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number }> {
  const windowMs = bucket.windowSec * 1000;
  const row = await store.get(key);
  if (!row || now - row.start >= windowMs) {
    await store.begin(key, now);
    return { allowed: true };
  }
  if (row.count >= bucket.max) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((row.start + windowMs - now) / 1000)) };
  await store.bump(key);
  return { allowed: true };
}

const prismaStore = (): LimitStore => {
  const db = useDb();
  return {
    async get(key) {
      const r = await db.rateLimit.findUnique({ where: { key } });
      return r ? { count: r.count, start: Number(r.lastRequest) } : null;
    },
    async begin(key, start) {
      await db.rateLimit.upsert({ where: { key }, create: { id: key, key, count: 1, lastRequest: BigInt(start) }, update: { count: 1, lastRequest: BigInt(start) } });
    },
    async bump(key) {
      await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    },
  };
};

/** Counts one request of `userId` against `name` and refuses (429) when the budget is spent. */
export async function limit(event: H3Event, userId: string, name: BucketName, store: () => LimitStore = prismaStore, now: () => number = Date.now): Promise<void> {
  let verdict: Awaited<ReturnType<typeof consume>>;
  try {
    verdict = await consume(store(), `api:${name}:${userId}`, BUCKETS[name], now());
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" && /^[A-Za-z0-9_]{1,40}$/.test((e as { code: string }).code) ? ` ${(e as { code: string }).code}` : "";
    console.error(`[rate-limit] store failed, request allowed: ${e instanceof Error ? e.name : typeof e}${code}`);
    return;
  }
  if (!verdict.allowed) {
    setHeader(event, "retry-after", String(verdict.retryAfterSec));
    throw jsonError(429, "rate_limited", { retryAfter: verdict.retryAfterSec });
  }
}
