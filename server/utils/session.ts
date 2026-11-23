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

/**
 * The admin guard. Everything that is not a signed-in, ENABLED super admin gets the same answer as a path that does not exist: 404 (signed out, an ordinary user, a disabled
 * account, a forged role header, accounts switched off, no database). The role comes from the SESSION'S user row, never from the request. The same-site check for a state-changing
 * request comes only after the role is known, so a stranger cannot tell the admin routes exist from the way they refuse.
 */
export async function requireSuperAdmin(event: H3Event): Promise<SessionUser> {
  const user = await (async (): Promise<SessionUser | null> => {
    try {
      requireEnabled(event);
      const session = await authOrUnavailable().api.getSession({ headers: new Headers(getRequestHeaders(event) as Record<string, string>) });
      return (session?.user as unknown as SessionUser | undefined) ?? null;
    } catch {
      return null; // anything that goes wrong is the same answer as "not an admin"
    }
  })();
  if (!user || user.disabled || user.role !== "superadmin") throw jsonError(404, "not_found");
  requireSameOrigin(event);
  return user;
}
