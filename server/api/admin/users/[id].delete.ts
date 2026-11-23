import { getRouterParam } from "h3";
import { readSmallJson, run } from "../../../utils/accountRoutes";
import { apiHandler } from "../../../utils/api";
import { adminDeps } from "../../../utils/adminRoutes";
import { deleteUser } from "../../../utils/adminService";
import { requireSuperAdmin } from "../../../utils/session";

// Delete a user and everything of theirs. Body { "confirm": "<their email>" }. Audited; never yourself, never the last super admin.
export default apiHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const body = await readSmallJson(event);
  return run(() => deleteUser(adminDeps(), { id: admin.id, email: admin.email }, getRouterParam(event, "id") ?? "", body.confirm));
});
