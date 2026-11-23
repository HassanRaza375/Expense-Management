// What every route that needs a signed-in user does first. The user comes from the SESSION COOKIE, never from the request body, query or a header the client chose:
// no route accepts a userId from the caller. The order is: flag (404) -> database (503) -> auth configured (503) -> session (401) -> account enabled (403).
import type { H3Event } from "h3";
import { getRequestHeader, getRequestHeaders } from "h3";
import { useAuth } from "./auth";
import { AuthConfigError } from "./authConfig";
import { jsonError, requireEnabled } from "./api";
import { sameOriginOk } from "./origin";
import type { AccountUser } from "./accountService";

export interface SessionUser extends AccountUser {
  emailVerified: boolean;
  disabled: boolean;
}

/** The Better Auth instance, or a 503 when the secret is not configured. */
export function authOrUnavailable() {
  try {
    return useAuth();
  } catch (e) {
    if (e instanceof AuthConfigError) {
      console.error(`[auth] not configured: ${e.message}`);
      throw jsonError(503, "unavailable");
    }
    throw e;
  }
}

/** Refuses a state-changing request that did not come from this site (CSRF). */
export function requireSameOrigin(event: H3Event): void {
  const ok = sameOriginOk({
    method: event.method,
    origin: getRequestHeader(event, "origin"),
    host: getRequestHeader(event, "x-forwarded-host") ?? getRequestHeader(event, "host"),
    secFetchSite: getRequestHeader(event, "sec-fetch-site"),
  });
  if (!ok) throw jsonError(403, "forbidden_origin");
}

/** The signed-in user, or null when nobody is. A disabled account is refused (403). Same guards as requireUser, but signed out is not an error. */
export async function optionalUser(event: H3Event): Promise<SessionUser | null> {
  requireEnabled(event);
  requireSameOrigin(event);
  const auth = authOrUnavailable();
  const session = await auth.api.getSession({ headers: new Headers(getRequestHeaders(event) as Record<string, string>) });
  if (!session) return null;
  const user = session.user as unknown as SessionUser;
  if (user.disabled) throw jsonError(403, "account_disabled");
  return user;
}

export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await optionalUser(event);
  if (!user) throw jsonError(401, "unauthenticated");
  return user;
}
