// The browser's side of the receipt routes. Same-origin; the session is the cookie. A file goes up as the raw request body (the browser's own shrunk photo, or a PDF).
import { ApiError, apiFetch, jsonInit } from "../account/api";

export async function uploadReceiptFile(id: string, blob: Blob, fetchImpl: typeof fetch = fetch): Promise<{ bytes: number }> {
  return apiFetch<{ bytes: number }>(`/api/receipts/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": blob.type || "application/octet-stream" }, body: blob }, fetchImpl);
}

/** A signed address (valid for a few minutes) to open one of this account's receipts. */
export async function receiptViewUrl(id: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await apiFetch<{ url: string }>(`/api/receipts/${encodeURIComponent(id)}`, { method: "GET" }, fetchImpl);
  return r.url;
}

export interface CleanupResult {
  files: number;
  orphans: number;
  bytes: number;
  removed: number;
}

/** What the account holds that no receipt points at; with `confirm` it is removed (from Cloudinary too). */
export function receiptCleanup(confirm: boolean, fetchImpl: typeof fetch = fetch): Promise<CleanupResult> {
  return apiFetch<CleanupResult>("/api/receipts/cleanup", jsonInit("POST", { confirm }), fetchImpl);
}

export { ApiError };
