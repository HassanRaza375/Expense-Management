import { deleteAccount } from "../../utils/accountService";
import { accountDeps, readSmallJson, run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { limit } from "../../utils/rateLimit";
import { requireUser } from "../../utils/session";

// Deletes the signed-in account and everything of theirs (database rows, then the Cloudinary files). Body: { "confirm": "<their own email>" }.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  await limit(event, user.id, "account.delete");
  const body = await readSmallJson(event);
  return run(() => deleteAccount(accountDeps(), user, body.confirm));
});
