import { receiptDeps, readSmallJson, run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { cleanupReceipts } from "../../utils/receiptService";
import { requireUser } from "../../utils/session";

// Receipt files that no receipt of this account points at any more. Body { "confirm": true } removes them (from Cloudinary too); without it nothing changes and the
// counts come back, so the page can say what would go.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  const body = await readSmallJson(event);
  return run(() => cleanupReceipts(receiptDeps(), user, body.confirm === true));
});
