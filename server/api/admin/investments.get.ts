import { apiHandler } from "../../utils/api";
import { adminDeps, adminQuery } from "../../utils/adminRoutes";
import { adminInvestments } from "../../utils/adminService";
import { requireSuperAdmin } from "../../utils/session";

// Totals from the projection columns only, for everyone or (with ?userId=) for one account the admin chose to look at.
export default apiHandler(async (event) => {
  await requireSuperAdmin(event);
  return adminInvestments(adminDeps(), adminQuery(event, ["userId"]).userId);
});
