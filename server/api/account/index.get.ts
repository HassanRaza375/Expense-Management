import { profileOf } from "../../utils/accountService";
import { apiHandler } from "../../utils/api";
import { cloudinaryStore } from "../../utils/media";
import { requireUser } from "../../utils/session";

// The signed-in account's own profile (id, email, name, role, photo URL). The user is the session's, never a parameter.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  return profileOf(user, cloudinaryStore(process.env));
});
