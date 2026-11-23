import { getRouterParam } from "h3";
import { readSmallJson, run } from "../../../utils/accountRoutes";
import { apiHandler } from "../../../utils/api";
import { adminDeps } from "../../../utils/adminRoutes";
import { updateUser } from "../../../utils/adminService";
import { requireSuperAdmin } from "../../../utils/session";

// Edit a user: name, email, role, disabled. Audited; the admin cannot change themself and the last super admin cannot be demoted or disabled.
export default apiHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const patch = await readSmallJson(event);
  return run(() => updateUser(adminDeps(), { id: admin.id, email: admin.email }, getRouterParam(event, "id") ?? "", patch));
});
