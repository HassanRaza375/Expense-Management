import { apiHandler } from "../../utils/api";
import { adminDeps, adminQuery } from "../../utils/adminRoutes";
import { adminUsers } from "../../utils/adminService";
import { requireSuperAdmin } from "../../utils/session";

export default apiHandler(async (event) => {
  await requireSuperAdmin(event);
  const q = adminQuery(event, ["search", "role", "status", "page"]);
  return adminUsers(adminDeps(), { search: q.search, role: q.role, status: q.status, page: Number(q.page) });
});
