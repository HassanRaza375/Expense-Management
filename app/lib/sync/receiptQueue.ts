// Which receipt files still have to go to the account. DERIVED, never stored (so it cannot be lost and an interrupted upload simply continues): a receipt waits when
//   - its record has reached the account (the server only accepts a file for a receipt it already has),
//   - it is not marked `remote` yet (the mark is set after the file is safely there, and syncs, so other devices know a copy exists),
//   - this device still has the file, and it has not been refused for good in this session (too large, not a picture or PDF).
import { RECEIPT_REMOTE_MAX_BYTES } from "./collections";

export interface ReceiptMeta {
  id: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  remote?: boolean;
}

export interface WaitingReceipt {
  expenseId: string;
  receipt: ReceiptMeta;
}

export function waitingReceipts(expenses: unknown, hasFile: (id: string) => boolean, isSynced: (receiptId: string) => boolean, refused: ReadonlySet<string> = new Set()): WaitingReceipt[] {
  const out: WaitingReceipt[] = [];
  if (!Array.isArray(expenses)) return out;
  for (const e of expenses) {
    if (!e || typeof e !== "object" || !Array.isArray((e as { receipts?: unknown }).receipts)) continue;
    for (const r of (e as { receipts: ReceiptMeta[] }).receipts) {
      if (!r || typeof r.id !== "string" || r.remote === true || refused.has(r.id) || !isSynced(r.id) || !hasFile(r.id)) continue;
      out.push({ expenseId: String((e as { id: unknown }).id), receipt: r });
    }
  }
  return out;
}

/** A refusal that will not change by trying again (so the file is left out for the rest of the session and reported), against one that might (offline, server trouble). */
export const isPermanentRefusal = (status: number, code: string): boolean => [400, 404, 409, 413, 415].includes(status) || code === "receipt_too_large" || code === "not_a_receipt";

export const tooLargeForAccount = (bytes: number): boolean => bytes > RECEIPT_REMOTE_MAX_BYTES;
