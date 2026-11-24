import { profileOf } from "../../utils/accountService";
import { apiHandler } from "../../utils/api";
import { cloudinaryStore } from "../../utils/media";
import { optionalUser } from "../../utils/session";

// "Who is signed in?" for the page. Signed out is an ordinary answer (200 with `profile: null`), not an error: a browser logs every 4xx as a console error, and asking is not a failure.
export default apiHandler(async (event) => {
  const user = await optionalUser(event);
  return { profile: user ? profileOf(user, cloudinaryStore(process.env)) : null };
});
