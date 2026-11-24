import { featureFlags } from "../../utils/authConfig";
import { apiHandler, requireEnabled } from "../../utils/api";

// What the Account page may say about the server: which sign-in options exist (booleans only, never a key). 404 while the flag is off.
export default apiHandler(async (event) => {
  requireEnabled(event);
  return featureFlags(process.env);
});
