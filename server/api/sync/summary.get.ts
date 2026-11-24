import { apiHandler } from "../../utils/api";
import { requireUser } from "../../utils/session";
import { requireSync, syncRepo } from "../../utils/syncRoutes";
import { summaryOf } from "../../utils/syncService";

// How much the signed-in account holds (counts only, never record content): for the first-sign-in choice and the Sync card.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  requireSync(event, user.id);
  return summaryOf(syncRepo(), user.id);
});
