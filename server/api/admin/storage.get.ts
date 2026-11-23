import { apiHandler } from "../../utils/api";
import { adminDeps } from "../../utils/adminRoutes";
import { adminStorage } from "../../utils/adminService";
import { requireSuperAdmin } from "../../utils/session";

// How many receipts and how many bytes, per account and in total. Counts and sizes only: never an image or a file name.
export default apiHandler(async (event) => {
  await requireSuperAdmin(event);
  return adminStorage(adminDeps());
});
