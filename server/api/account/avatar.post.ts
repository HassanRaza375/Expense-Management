import { MAX_AVATAR_BYTES, saveAvatar } from "../../utils/accountService";
import { accountDeps, readLimitedBytes, run } from "../../utils/accountRoutes";
import { apiHandler } from "../../utils/api";
import { limit } from "../../utils/rateLimit";
import { requireUser } from "../../utils/session";

// The profile photo: the browser sends its own square crop (a JPEG, at most 512 KB) as the raw request body. The file type is checked from the bytes.
export default apiHandler(async (event) => {
  const user = await requireUser(event);
  await limit(event, user.id, "avatar.write");
  const bytes = await readLimitedBytes(event, MAX_AVATAR_BYTES);
  return run(() => saveAvatar(accountDeps(), user, bytes));
});
