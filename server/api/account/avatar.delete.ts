import { removeAvatar } from "../../utils/accountService";
import { accountDeps, run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { requireUser } from "../../utils/session";

// Removes the profile photo (the account falls back to the generated avatar).
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  return run(() => removeAvatar(accountDeps(), user));
});
