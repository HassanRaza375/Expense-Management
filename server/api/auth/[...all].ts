import { toWebRequest } from "h3";
import { apiHandler, requireEnabled } from "../../utils/api";
import { authOrUnavailable } from "../../utils/session";

// Better Auth's own routes (sign up, sign in, sign out, session, password change, Google, email verification, reset). 404 while the flag is off.
// Its rate limits (stored in the database) and its origin checks apply here.
export default apiHandler(async (event) => {
  requireEnabled(event);
  return authOrUnavailable().handler(toWebRequest(event));
});
