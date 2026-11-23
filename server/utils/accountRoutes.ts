// Shared by the routes in server/api/account/*: the dependencies of the account service, ServiceError to JSON, and bounded body readers.
import type { H3Event } from "h3";
import { getRequestHeader, readBody, readRawBody } from "h3";
import { ServiceError, type Deps } from "./accountService";
import { prismaAccountRepo } from "./accountRepo";
import { jsonError } from "./api";
import { useDb } from "./db";
import { cloudinaryStore } from "./media";
import { prismaSyncRepo } from "./syncRepo";

export const accountDeps = (): Deps => ({ repo: prismaAccountRepo(useDb()), media: cloudinaryStore(process.env) });

/** The dependencies of the receipt routes: the user's sync records and the media store. */
export const receiptDeps = (): { repo: ReturnType<typeof prismaSyncRepo>; media: ReturnType<typeof cloudinaryStore> } => ({ repo: prismaSyncRepo(), media: cloudinaryStore(process.env) });

/** Runs a service call; a ServiceError becomes the JSON refusal it names. */
export async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ServiceError) throw jsonError(e.status, e.code);
    throw e;
  }
}

function declaredLength(event: H3Event): number {
  const n = Number(getRequestHeader(event, "content-length"));
  return Number.isFinite(n) ? n : 0;
}

/** The raw request body, refused (413) when it declares or turns out to be bigger than `max` bytes. */
export async function readLimitedBytes(event: H3Event, max: number, code = "photo_too_large"): Promise<Uint8Array> {
  if (declaredLength(event) > max) throw jsonError(413, code);
  const raw = await readRawBody(event, false);
  if (!raw) return new Uint8Array();
  if (raw.length > max) throw jsonError(413, code);
  return raw;
}

/** A small JSON body (never more than 4 KB: nothing in the account area is bigger). */
export async function readSmallJson(event: H3Event): Promise<Record<string, unknown>> {
  if (declaredLength(event) > 4096) throw jsonError(413, "too_large");
  const body = await readBody(event).catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
