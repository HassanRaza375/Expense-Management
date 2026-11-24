import { apiHandler } from "../../utils/api";
import { adminDeps } from "../../utils/adminRoutes";
import { adminOverview } from "../../utils/adminService";
import { requireSuperAdmin } from "../../utils/session";

// Totals across all accounts: counts and amounts only. 404 to everyone who is not a signed-in super admin.
export default apiHandler(async (event) => {
  await requireSuperAdmin(event);
  return adminOverview(adminDeps());
});
