import { getRouterParam } from "h3";
import { run } from "../../../utils/accountRoutes";
import { apiHandler } from "../../../utils/api";
import { adminDeps } from "../../../utils/adminRoutes";
import { adminUserDetail } from "../../../utils/adminService";
import { requireSuperAdmin } from "../../../utils/session";

export default apiHandler(async (event) => {
  await requireSuperAdmin(event);
  return run(() => adminUserDetail(adminDeps(), getRouterParam(event, "id") ?? ""));
});
