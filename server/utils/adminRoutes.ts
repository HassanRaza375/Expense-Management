// Shared by the routes in server/api/admin/*: the dependencies of the admin service, the filters a list may be given, and the reset-email sender.
import type { H3Event } from "h3";
import { getQuery } from "h3";
import { cloudinaryStore } from "./media";
import { authOrUnavailable } from "./session";
import { emailEnabled } from "./authConfig";
import { prismaAdminRepo } from "./adminRepo";
import type { AdminDeps } from "./adminService";

export const adminDeps = (): AdminDeps => ({
  repo: prismaAdminRepo(),
  media: cloudinaryStore(process.env),
  // the password-reset email goes through Better Auth (its own token and page); null while email is not set up
  sendReset: emailEnabled(process.env)
    ? async (email) => {
        const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
        await authOrUnavailable().api.requestPasswordReset({ body: { email, redirectTo: `${base}/account` } });
      }
    : null,
});

/** Only the named query parameters, as short strings (an admin list may be filtered, never told which user to be). */
export function adminQuery(event: H3Event, names: string[]): Record<string, string | undefined> {
  const q = getQuery(event);
  const out: Record<string, string | undefined> = {};
  for (const n of names) {
    const v = q[n];
    out[n] = typeof v === "string" && v.length <= 100 ? v : undefined;
  }
  return out;
}
