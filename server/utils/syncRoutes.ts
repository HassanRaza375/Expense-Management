// Shared by the routes in server/api/sync/*.
import type { H3Event } from "h3";
import { getRequestHeader, readRawBody } from "h3";
import { jsonError } from "./api";
import { prismaSyncRepo } from "./syncRepo";
import { checkSchema } from "./syncService";

export const syncRepo = () => prismaSyncRepo();

/** Refuses a client whose data version is not the server's (the app must be updated): 409 schema_mismatch. */
export const requireSchema = (event: H3Event): void => checkSchema(getRequestHeader(event, "x-hisaab-schema"));

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
