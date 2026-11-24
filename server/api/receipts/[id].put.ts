import { getRouterParam } from "h3";
import { RECEIPT_REMOTE_MAX_BYTES } from "../../../app/lib/sync/collections";
import { readLimitedBytes, receiptDeps, run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { uploadReceipt } from "../../utils/receiptService";
import { limit } from "../../utils/rateLimit";
import { requireUser } from "../../utils/session";

// A receipt file (the browser's own shrunk photo, or a PDF) for a receipt record this account has already synced. The id is the RECEIPT's id; the owner is the session's.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  await limit(event, user.id, "receipt.put");
  const id = getRouterParam(event, "id") ?? "";
  const bytes = await readLimitedBytes(event, RECEIPT_REMOTE_MAX_BYTES, "receipt_too_large");
  return run(() => uploadReceipt(receiptDeps(), user, id, bytes));
});
