// What every account, sync, photo, receipt and admin route does first. The flag is read at request time (a route answers 404 while sync is off, as if it did not
// exist), the database must be configured (503 otherwise). Later phases add the session checks here (requireUser, requireSuperAdmin).
import type { EventHandlerRequest, EventHandlerResponse, H3Event } from "h3";
import { createError, isError, setHeader, setResponseStatus } from "h3";
import { isSyncOn } from "../../app/lib/sync/flag";
import { hasDatabase } from "./db";

/**
 * Every route is wrapped in this. A refusal thrown by a guard (404 while the flag is off, 401, 429 ...) is answered as JSON whatever the request accepts: h3
 * would otherwise answer a browser navigation (Accept: text/html) with an HTML error page, and an /api/ address must never answer HTML.
 * An unexpected error is answered as `{ error: "server_error" }` and logged WITHOUT its message (a message can hold a connection string or a record).
 */
export function apiHandler<T extends EventHandlerRequest = EventHandlerRequest, R extends EventHandlerResponse = EventHandlerResponse>(fn: (event: H3Event<T>) => R | Promise<R>) {
  return defineEventHandler<T>(async (event) => {
    try {
      return await fn(event);
    } catch (e) {
      setHeader(event, "content-type", "application/json; charset=utf-8");
      setHeader(event, "cache-control", "no-store");
      if (isError(e)) {
        setResponseStatus(event, e.statusCode);
        return (e.data as object | undefined) ?? { error: "error" };
      }
      // the error's name and, when it has one, its short code (a Prisma "P2002", a Node "ECONNRESET"): never its message, which can hold a connection string or a record
      const code = e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" && /^[A-Za-z0-9_]{1,40}$/.test((e as { code: string }).code) ? ` ${(e as { code: string }).code}` : "";
      console.error(`[api] unexpected error in ${event.method} ${event.path.split("?")[0]}: ${e instanceof Error ? e.name : typeof e}${code}`);
      setResponseStatus(event, 500);
      return { error: "server_error" };
    }
  });
}

/** True when this request's server has sync switched on (read at request time from the runtime config). */
export const syncOn = (event: H3Event): boolean => isSyncOn(useRuntimeConfig(event).public.syncEnabled);

export const jsonError = (statusCode: number, error: string, extra: Record<string, unknown> = {}) =>
  createError({ statusCode, statusMessage: error, data: { error, ...extra } });

/** 404 while the flag is off; 503 with no database. Call first in every route that is part of Account & Sync. */
export function requireEnabled(event: H3Event): void {
  if (!syncOn(event)) throw jsonError(404, "not_found");
  if (!hasDatabase()) throw jsonError(503, "unavailable");
}
