import { LIMITS } from "../../../app/lib/sync/collections";
import { run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { requireUser } from "../../utils/session";
import { readJsonLimited, requireSync, syncRepo } from "../../utils/syncRoutes";
import { applyPush } from "../../utils/syncService";

// Applies this device's changes to the signed-in account. Body: { ops: [...] } (at most 200 operations, 1 MB). Each operation is answered on its own:
// ok (with the new revision), conflict (with the current record: pull, merge, push again) or rejected (with a reason).
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  requireSync(event, user.id);
  const body = await readJsonLimited(event, LIMITS.maxPushBytes);
  return run(() => applyPush(syncRepo(), user.id, body));
});
