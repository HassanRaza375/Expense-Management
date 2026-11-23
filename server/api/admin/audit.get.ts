import { apiHandler } from "../../utils/api";
import { adminDeps, adminQuery } from "../../utils/adminRoutes";
import { adminAudit } from "../../utils/adminService";
import { requireSuperAdmin } from "../../utils/session";

export default apiHandler(async (event) => {
  await requireSuperAdmin(event);
  return adminAudit(adminDeps(), Number(adminQuery(event, ["page"]).page));
});
