// Receipt files: upload, a short-lived signed address to view one, and the confirmed clean-up of orphans. Pure logic over the sync repository and the media store, so unit
// tests run the real rules with fakes. The user is the SESSION's (the route took it from there); a receipt is only ever reached through the account's own records:
//   - a file is accepted only for a receipt RECORD that this user has already synced (its expense must be live, at most 5 receipts per expense);
//   - the bytes are checked (JPEG, PNG, WebP or PDF; the claimed type is never trusted) and capped at 10 MB (D25);
//   - files are PRIVATE: nothing is ever delivered from a public address; a signed address lasts 5 minutes and is made only after the ownership check;
//   - deleting an expense (or its receipt record) never deletes a file. Only `cleanupReceipts`, which the person confirms, removes the files that no live receipt
//     record points at, and it removes them from Cloudinary too.
import { RECEIPTS_PER_EXPENSE, RECEIPT_REMOTE_MAX_BYTES } from "../../app/lib/sync/collections";
import { ServiceError, type AccountUser } from "./accountService";
import { receiptIdOf, receiptPublicId, receiptsPrefix, type MediaStore } from "./media";
import type { SyncRepo } from "./syncTypes";

export const SIGNED_URL_SECONDS = 300;

export interface ReceiptDeps {
  repo: SyncRepo;
  media: MediaStore | null;
}

export type ReceiptKind = { mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; format: "jpg" | "png" | "webp" | "pdf" };

/** What a receipt file really is, from its first bytes. */
export function sniffReceipt(b: Uint8Array): ReceiptKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", format: "jpg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return { mime: "image/png", format: "png" };
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { mime: "image/webp", format: "webp" };
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return { mime: "application/pdf", format: "pdf" };
  return null;
}

const FORMAT_OF: Record<string, ReceiptKind["format"]> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

interface ReceiptData {
  expenseId?: unknown;
  mimeType?: unknown;
  size?: unknown;
}

/** The user's own live receipt record, or null. A record that does not exist, is deleted, or belongs to somebody else is the same answer: not found. */
async function ownReceipt(repo: SyncRepo, userId: string, id: string) {
  const row = await repo.get(userId, "receipt", id);
  if (!row || row.deleted || !row.data || typeof row.data !== "object") return null;
  const d = row.data as ReceiptData;
  return typeof d.expenseId === "string" ? { expenseId: d.expenseId, mimeType: typeof d.mimeType === "string" ? d.mimeType : "" } : null;
}

export async function uploadReceipt({ repo, media }: ReceiptDeps, user: AccountUser, id: string, bytes: Uint8Array) {
  if (!media) throw new ServiceError(503, "media_unavailable");
  if (bytes.length === 0) throw new ServiceError(400, "empty_file");
  if (bytes.length > RECEIPT_REMOTE_MAX_BYTES) throw new ServiceError(413, "receipt_too_large");
  const kind = sniffReceipt(bytes);
  if (!kind) throw new ServiceError(415, "not_a_receipt");
  const rec = await ownReceipt(repo, user.id, id);
  if (!rec) throw new ServiceError(404, "receipt_not_found"); // not synced yet, deleted, or not this user's
  const expense = await repo.get(user.id, "expense", rec.expenseId);
  if (!expense || expense.deleted) throw new ServiceError(404, "expense_not_found");
  const siblings = await repo.liveIds(user.id, "receipt", rec.expenseId);
  if (siblings.length > RECEIPTS_PER_EXPENSE) throw new ServiceError(409, "too_many_receipts");
  const up = await media.uploadReceipt({ publicId: receiptPublicId(media.root, user.id, id), bytes: Buffer.from(bytes) });
  return { id, bytes: up.bytes, mimeType: kind.mime };
}

/** A signed address that works for 5 minutes, for the user's own live receipt. */
export async function receiptUrl({ repo, media }: ReceiptDeps, user: AccountUser, id: string) {
  if (!media) throw new ServiceError(503, "media_unavailable");
  const rec = await ownReceipt(repo, user.id, id);
  if (!rec) throw new ServiceError(404, "receipt_not_found");
  const format = FORMAT_OF[rec.mimeType] ?? "jpg";
  return { url: media.signedUrl(receiptPublicId(media.root, user.id, id), { format, expiresInSeconds: SIGNED_URL_SECONDS }), expiresIn: SIGNED_URL_SECONDS };
}

/**
 * The files under this user's receipts folder that no live receipt record points at ("orphans"). With `confirmed` they are removed from Cloudinary; without it nothing
 * is changed and the counts are returned (so the page can say what would go before it is confirmed).
 */
export async function cleanupReceipts({ repo, media }: ReceiptDeps, user: AccountUser, confirmed: boolean) {
  if (!media) throw new ServiceError(503, "media_unavailable");
  const files = await media.listReceipts(receiptsPrefix(media.root, user.id));
  const live = new Set(await repo.liveIds(user.id, "receipt"));
  const orphans = files.filter((f) => !live.has(receiptIdOf(f.publicId)));
  const bytes = orphans.reduce((n, f) => n + f.bytes, 0);
  let removed = 0;
  if (confirmed) {
    for (const f of orphans) {
      await media.destroy(f.publicId, "authenticated");
      removed++;
    }
  }
  return { files: files.length, orphans: orphans.length, bytes, removed };
}
