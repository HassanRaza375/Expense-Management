import { getRouterParam } from "h3";
import { receiptDeps, run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { receiptUrl } from "../../utils/receiptService";
import { limit } from "../../utils/rateLimit";
import { requireUser } from "../../utils/session";

// A signed address (valid for 5 minutes) to view one of the signed-in account's own receipts. Files are private: there is no other way to reach one.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  await limit(event, user.id, "receipt.get");
  const id = getRouterParam(event, "id") ?? "";
  return run(() => receiptUrl(receiptDeps(), user, id));
});
