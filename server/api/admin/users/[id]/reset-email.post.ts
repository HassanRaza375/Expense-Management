import { getRouterParam } from "h3";
import { run } from "../../../../utils/accountRoutes";
import { apiHandler } from "../../../../utils/api";
import { adminDeps } from "../../../../utils/adminRoutes";
import { sendResetEmail } from "../../../../utils/adminService";
import { requireSuperAdmin } from "../../../../utils/session";

// Sends the user a password-reset email (503 while email is not set up). The admin never sees or sets a password.
export default apiHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  return run(() => sendResetEmail(adminDeps(), { id: admin.id, email: admin.email }, getRouterParam(event, "id") ?? ""));
});
