// Shared by the routes in server/api/sync/*.
import type { H3Event } from "h3";
import { getRequestHeader, readRawBody } from "h3";
import { ServiceError } from "./accountService";
import { jsonError } from "./api";
import { prismaSyncRepo } from "./syncRepo";
import { checkSchema } from "./syncService";

export const syncRepo = () => prismaSyncRepo();

/**
 * The sync checks every route makes right after the session: the client's data version must be the server's (409 schema_mismatch: the app must be updated), and the
 * account the browser says it is syncing for (`x-hisaab-account`) must be the one the session cookie belongs to (409 account_mismatch). Without that second check a
 * browser holding one person's cache could push it into another person's account after a sign-in in another tab.
 */
export function requireSync(event: H3Event, userId: string): void {
  try {
    checkSchema(getRequestHeader(event, "x-hisaab-schema"));
  } catch (e) {
    if (e instanceof ServiceError) throw jsonError(e.status, e.code); // a ServiceError is not an HTTP error: answered here as the JSON refusal it names
    throw e;
  }
  if (getRequestHeader(event, "x-hisaab-account") !== userId) throw jsonError(409, "account_mismatch");
}

/** A JSON body, refused (413) above `max` bytes (by the declared length and by the real one) and (400) when it is not JSON. */
export async function readJsonLimited(event: H3Event, max: number): Promise<unknown> {
  const declared = Number(getRequestHeader(event, "content-length"));
  if (Number.isFinite(declared) && declared > max) throw jsonError(413, "too_large");
  const raw = await readRawBody(event, "utf8");
  if (!raw) throw jsonError(400, "invalid_request");
  if (Buffer.byteLength(raw) > max) throw jsonError(413, "too_large");
  try {
    return JSON.parse(raw);
  } catch {
    throw jsonError(400, "invalid_request");
  }
}
