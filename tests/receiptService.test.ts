import { describe, expect, it } from "vitest";
import { RECEIPTS_PER_EXPENSE, RECEIPT_REMOTE_MAX_BYTES } from "../app/lib/sync/collections";
import type { AccountUser } from "../server/utils/accountService";
import type { MediaStore } from "../server/utils/media";
import { SIGNED_URL_SECONDS, cleanupReceipts, receiptUrl, sniffReceipt, uploadReceipt } from "../server/utils/receiptService";
import { applyPush } from "../server/utils/syncService";
import { fakeSyncRepo } from "./fakes/syncRepo";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n..."));
const A: AccountUser = { id: "user-a", email: "a@example.test", name: "A", role: "user" };
const B: AccountUser = { id: "user-b", email: "b@example.test", name: "B", role: "user" };

function setup() {
  const repo = fakeSyncRepo();
  const uploaded: string[] = [];
  const destroyed: string[] = [];
  const listed: string[] = [];
  const files = new Map<string, { publicId: string; bytes: number }[]>(); // prefix -> files
  const media: MediaStore = {
    cloudName: "demo",
    root: "hisaab-test",
    uploadImage: async () => ({ publicId: "x", version: 1, bytes: 1 }),
    uploadReceipt: async ({ publicId, bytes }) => (uploaded.push(publicId), { publicId, version: 1, bytes: bytes.length }),
    signedUrl: (publicId, { format, expiresInSeconds }) => `https://signed.example/${publicId}.${format}?expires=${expiresInSeconds}`,
    listReceipts: async (prefix) => (listed.push(prefix), files.get(prefix) ?? []),
    destroy: async (publicId, type) => void destroyed.push(`${type}:${publicId}`),
    deleteByPrefix: async () => 0,
  };
  const deps = { repo, media };
  const sync = (user: AccountUser, ops: unknown[]) => applyPush(repo, user.id, { ops });
  const expense = (id: string) => ({ collection: "expense", id, base: 0, put: { id, date: "2026-11-20T07:00:00.000Z", amount: 5, categoryId: "c" }, dayKey: "2026-11-20" });
  const receipt = (id: string, expenseId: string, mime = "image/jpeg", size = 6) => ({ collection: "receipt", id, base: 0, put: { id, expenseId, filename: "r.jpg", mimeType: mime, size }, dayKey: null });
  return { repo, media, deps, uploaded, destroyed, listed, files, sync, expense, receipt };
}

describe("sniffReceipt reads the bytes, not the claimed type", () => {
  it("accepts a photo or a PDF and nothing else", () => {
    expect(sniffReceipt(JPEG)?.format).toBe("jpg");
    expect(sniffReceipt(PNG)?.format).toBe("png");
    expect(sniffReceipt(PDF)).toEqual({ mime: "application/pdf", format: "pdf" });
    for (const bad of ["<html><script>1</script>", '<svg xmlns="http://www.w3.org/2000/svg"/>', "GIF89a....", "PK\u0003\u0004zip", "MZ\u0090 program", ""]) expect(sniffReceipt(Buffer.from(bad)), bad).toBeNull();
  });
});

describe("uploadReceipt", () => {
  it("stores the file privately under the user's own folder, for a receipt record the account already has", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1")]);
    const out = await uploadReceipt(t.deps, A, "r1", JPEG);
    expect(t.uploaded).toEqual(["hisaab-test/u/user-a/receipts/r1"]);
    expect(out).toMatchObject({ id: "r1", mimeType: "image/jpeg" });
  });

  it("a PDF is accepted too", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1", "application/pdf")]);
    await expect(uploadReceipt(t.deps, A, "r1", PDF)).resolves.toMatchObject({ mimeType: "application/pdf" });
  });

  it("refuses, with nothing uploaded: no media store, empty, over 10 MB, not a photo or PDF", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1")]);
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { status: number; code: string }) => `${e.status}:${e.code}`);
    expect(await code(uploadReceipt({ repo: t.repo, media: null }, A, "r1", JPEG))).toBe("503:media_unavailable");
    expect(await code(uploadReceipt(t.deps, A, "r1", new Uint8Array()))).toBe("400:empty_file");
    const big = new Uint8Array(RECEIPT_REMOTE_MAX_BYTES + 1);
    big.set(JPEG);
    expect(await code(uploadReceipt(t.deps, A, "r1", big))).toBe("413:receipt_too_large");
    expect(await code(uploadReceipt(t.deps, A, "r1", Buffer.from("<svg onload=alert(1)>")))).toBe("415:not_a_receipt");
    expect(t.uploaded).toEqual([]);
  });

  it("exactly 10 MB is accepted", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1")]);
    const edge = new Uint8Array(RECEIPT_REMOTE_MAX_BYTES);
    edge.set(JPEG);
    await expect(uploadReceipt(t.deps, A, "r1", edge)).resolves.toBeTruthy();
  });

  it("needs the receipt record to be synced first, live, and its expense to be live", async () => {
    const t = setup();
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { status: number; code: string }) => `${e.status}:${e.code}`);
    expect(await code(uploadReceipt(t.deps, A, "r1", JPEG))).toBe("404:receipt_not_found"); // nothing synced
    await t.sync(A, [t.receipt("r1", "e-missing")]);
    expect(await code(uploadReceipt(t.deps, A, "r1", JPEG))).toBe("404:expense_not_found");
    await t.sync(A, [t.expense("e1"), t.receipt("r2", "e1")]);
    await t.sync(A, [{ collection: "receipt", id: "r2", base: 3, delete: true }]);
    expect(await code(uploadReceipt(t.deps, A, "r2", JPEG))).toBe("404:receipt_not_found"); // a deleted record
    expect(t.uploaded).toEqual([]);
  });

  it(`an expense has at most ${RECEIPTS_PER_EXPENSE} receipts`, async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), ...Array.from({ length: RECEIPTS_PER_EXPENSE + 1 }, (_, i) => t.receipt(`r${i}`, "e1"))]);
    await expect(uploadReceipt(t.deps, A, "r0", JPEG)).rejects.toMatchObject({ status: 409, code: "too_many_receipts" });
    const t2 = setup();
    await t2.sync(A, [t2.expense("e1"), ...Array.from({ length: RECEIPTS_PER_EXPENSE }, (_, i) => t2.receipt(`r${i}`, "e1"))]);
    await expect(uploadReceipt(t2.deps, A, "r0", JPEG)).resolves.toBeTruthy();
  });
});

describe("one account never reaches another's receipts", () => {
  it("B cannot upload for, or get a link to, a receipt that is A's, even knowing its id", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1")]);
    await expect(uploadReceipt(t.deps, B, "r1", JPEG)).rejects.toMatchObject({ status: 404 });
    await expect(receiptUrl(t.deps, B, "r1")).rejects.toMatchObject({ status: 404 });
    expect(t.uploaded).toEqual([]);
  });

  it("the same receipt id in two accounts is two receipts, each in its own folder", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("same", "e1")]);
    await t.sync(B, [t.expense("e1"), t.receipt("same", "e1")]);
    await uploadReceipt(t.deps, A, "same", JPEG);
    await uploadReceipt(t.deps, B, "same", PNG);
    expect(t.uploaded).toEqual(["hisaab-test/u/user-a/receipts/same", "hisaab-test/u/user-b/receipts/same"]);
    expect((await receiptUrl(t.deps, B, "same")).url).toContain("/u/user-b/");
    expect((await receiptUrl(t.deps, B, "same")).url).not.toContain("user-a");
  });
});

describe("receiptUrl: private files, short-lived signed addresses", () => {
  it("is made only after the ownership check, lasts 5 minutes, and uses the file's own format", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1", "application/pdf"), t.receipt("r2", "e1", "image/png")]);
    const pdf = await receiptUrl(t.deps, A, "r1");
    expect(pdf.expiresIn).toBe(SIGNED_URL_SECONDS);
    expect(SIGNED_URL_SECONDS).toBeLessThanOrEqual(300);
    expect(pdf.url).toBe("https://signed.example/hisaab-test/u/user-a/receipts/r1.pdf?expires=300");
    expect((await receiptUrl(t.deps, A, "r2")).url).toMatch(/\.png\?/);
  });

  it("a receipt that does not exist, or is deleted, has no link", async () => {
    const t = setup();
    await expect(receiptUrl(t.deps, A, "nope")).rejects.toMatchObject({ status: 404 });
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1")]);
    await t.sync(A, [{ collection: "receipt", id: "r1", base: 2, delete: true }]);
    await expect(receiptUrl(t.deps, A, "r1")).rejects.toMatchObject({ status: 404 });
    await expect(receiptUrl({ repo: t.repo, media: null }, A, "r1")).rejects.toMatchObject({ status: 503 });
  });
});

describe("deleting never deletes a file; only the confirmed clean-up does", () => {
  it("deleting an expense (and its receipts' records) leaves every file where it is", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("r1", "e1")]);
    await uploadReceipt(t.deps, A, "r1", JPEG);
    await t.sync(A, [
      { collection: "expense", id: "e1", base: 1, delete: true },
      { collection: "receipt", id: "r1", base: 2, delete: true },
    ]);
    expect(t.destroyed).toEqual([]);
  });

  it("the clean-up lists the orphans without changing anything until it is confirmed", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("live", "e1"), t.receipt("gone", "e1")]);
    await t.sync(A, [{ collection: "receipt", id: "gone", base: 3, delete: true }]);
    t.files.set("hisaab-test/u/user-a/receipts", [
      { publicId: "hisaab-test/u/user-a/receipts/live", bytes: 100 },
      { publicId: "hisaab-test/u/user-a/receipts/gone", bytes: 250 },
      { publicId: "hisaab-test/u/user-a/receipts/never-registered", bytes: 50 },
    ]);
    const dry = await cleanupReceipts(t.deps, A, false);
    expect(dry).toEqual({ files: 3, orphans: 2, bytes: 300, removed: 0 });
    expect(t.destroyed).toEqual([]);
    const done = await cleanupReceipts(t.deps, A, true);
    expect(done).toMatchObject({ orphans: 2, removed: 2 });
    expect(t.destroyed.sort()).toEqual(["authenticated:hisaab-test/u/user-a/receipts/gone", "authenticated:hisaab-test/u/user-a/receipts/never-registered"]);
  });

  it("looks only in the user's own receipts folder, and a file that a live receipt points at is never removed", async () => {
    const t = setup();
    await t.sync(A, [t.expense("e1"), t.receipt("live", "e1")]);
    t.files.set("hisaab-test/u/user-a/receipts", [{ publicId: "hisaab-test/u/user-a/receipts/live", bytes: 10 }]);
    t.files.set("hisaab-test/u/user-b/receipts", [{ publicId: "hisaab-test/u/user-b/receipts/b-file", bytes: 10 }]);
    const out = await cleanupReceipts(t.deps, A, true);
    expect(out).toMatchObject({ orphans: 0, removed: 0 });
    expect(t.listed).toEqual(["hisaab-test/u/user-a/receipts"]); // never B's folder
    expect(t.destroyed).toEqual([]);
    await expect(cleanupReceipts({ repo: t.repo, media: null }, A, true)).rejects.toMatchObject({ status: 503 });
  });
});
