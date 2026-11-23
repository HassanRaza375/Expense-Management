import { describe, expect, it } from "vitest";
import { isPermanentRefusal, tooLargeForAccount, waitingReceipts } from "../app/lib/sync/receiptQueue";
import { RECEIPT_REMOTE_MAX_BYTES } from "../app/lib/sync/collections";

const expenses = [
  { id: "e1", receipts: [{ id: "r1" }, { id: "r2", remote: true }, { id: "r3" }] },
  { id: "e2" },
  { id: "e3", receipts: [{ id: "r4" }] },
  null,
  { id: "e5", receipts: "not a list" },
];
const all = () => true;

describe("waitingReceipts (derived: nothing is stored, so nothing can be lost and an interrupted upload simply continues)", () => {
  it("a receipt waits when its record has reached the account, it is not marked remote, and this device has the file", () => {
    const synced = new Set(["r1", "r2", "r3", "r4"]);
    const out = waitingReceipts(expenses, all, (id) => synced.has(id));
    expect(out.map((w) => [w.expenseId, w.receipt.id])).toEqual([["e1", "r1"], ["e1", "r3"], ["e3", "r4"]]);
  });

  it("not before its record has reached the account (the server only accepts a file for a receipt it has)", () => {
    expect(waitingReceipts(expenses, all, (id) => id === "r4").map((w) => w.receipt.id)).toEqual(["r4"]);
    expect(waitingReceipts(expenses, all, () => false)).toEqual([]);
  });

  it("not when the file is not on this device, and not once marked remote", () => {
    expect(waitingReceipts(expenses, (id) => id !== "r1", all).map((w) => w.receipt.id)).toEqual(["r3", "r4"]);
    expect(waitingReceipts(expenses, all, all).some((w) => w.receipt.id === "r2")).toBe(false);
  });

  it("not for a file refused for good in this session", () => {
    expect(waitingReceipts(expenses, all, all, new Set(["r1", "r4"])).map((w) => w.receipt.id)).toEqual(["r3"]);
  });

  it("copes with anything that is not a list of expenses", () => {
    for (const bad of [null, undefined, {}, "x", 5]) expect(waitingReceipts(bad, all, all)).toEqual([]);
  });

  it("running it again after one was marked remote leaves only the rest (resuming)", () => {
    const exp = JSON.parse(JSON.stringify(expenses));
    expect(waitingReceipts(exp, all, all)).toHaveLength(3);
    exp[0].receipts[0].remote = true;
    expect(waitingReceipts(exp, all, all).map((w) => w.receipt.id)).toEqual(["r3", "r4"]);
  });
});

describe("refusals", () => {
  it("one that will not change by trying again is permanent; being offline or a server problem is not", () => {
    for (const [status, code] of [[413, "receipt_too_large"], [415, "not_a_receipt"], [404, "receipt_not_found"], [409, "too_many_receipts"], [400, "empty_file"]] as const) expect(isPermanentRefusal(status, code), code).toBe(true);
    for (const [status, code] of [[0, "offline"], [500, "server_error"], [503, "media_unavailable"], [401, "unauthenticated"], [429, "RATE_LIMITED"]] as const) expect(isPermanentRefusal(status, code), code).toBe(false);
  });
  it("the account's file limit is 10 MB, inclusive", () => {
    expect(tooLargeForAccount(RECEIPT_REMOTE_MAX_BYTES)).toBe(false);
    expect(tooLargeForAccount(RECEIPT_REMOTE_MAX_BYTES + 1)).toBe(true);
    expect(RECEIPT_REMOTE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
