import { run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { requireUser } from "../../utils/session";
import { readJsonLimited, requireSync, syncRepo } from "../../utils/syncRoutes";
import { pullSince } from "../../utils/syncService";

// The signed-in account's records changed after revision `since` (body: { since }), oldest first, in pages (`more` says there is another).
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  requireSync(event, user.id);
  const body = (await readJsonLimited(event, 1024)) as { since?: unknown };
  return run(() => pullSince(syncRepo(), user.id, body?.since));
});
