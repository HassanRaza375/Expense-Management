// The browser's side of the sync routes: the SyncApi the engine talks to. Same-origin only; the session is the cookie. Every refusal becomes a SyncApiError with a
// kind the UI understands (offline, signed out, disabled, app too old, slow down, server trouble).
import { ApiError, apiFetch, jsonInit } from "../account/api";
import { SyncApiError, type SyncApi } from "./engine";
import { SYNC_SCHEMA_VERSION } from "./collections";
import type { PullResponse, PushResponse, SummaryResponse } from "./protocol";

export function toSyncError(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  if (e.status === 0) return new SyncApiError("offline");
  if (e.status === 401) return new SyncApiError("unauthenticated", 401);
  if (e.status === 403) return new SyncApiError("disabled", 403);
  if (e.status === 409 && e.code === "schema_mismatch") return new SyncApiError("schema", 409);
  if (e.status === 409 && e.code === "account_mismatch") return new SyncApiError("account", 409);
  if (e.status === 429) return new SyncApiError("rate", 429);
  if (e.status === 404 || e.status === 503) return new SyncApiError("server", e.status); // not turned on / not available right now
  return new SyncApiError("server", e.status);
}

/** every sync request names the data version AND the account this browser is syncing for: the server refuses it if the session belongs to someone else */
const withIdentity = (userId: string, init: RequestInit): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), "x-hisaab-schema": String(SYNC_SCHEMA_VERSION), "x-hisaab-account": userId },
});

export function httpSyncApi(userId: string, fetchImpl: typeof fetch = fetch): SyncApi & { summary(): Promise<SummaryResponse> } {
  const call = async <T>(path: string, init: RequestInit): Promise<T> => {
    try {
      return await apiFetch<T>(path, withIdentity(userId, init), fetchImpl);
    } catch (e) {
      throw toSyncError(e);
    }
  };
  return {
    push: (ops) => call<PushResponse>("/api/sync/push", jsonInit("POST", { ops })),
    pull: (since) => call<PullResponse>("/api/sync/pull", jsonInit("POST", { since })),
    summary: () => call<SummaryResponse>("/api/sync/summary", { method: "GET" }),
  };
}
