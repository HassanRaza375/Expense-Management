// The one Better Auth instance of a server instance, created on first use (never at import). Options that come only from the environment are in authConfig.ts.
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { authOptions } from "./authConfig";
import { useDb } from "./db";
import { resendMailer } from "./mailer";

function create() {
  const env = process.env;
  const db = useDb();
  return betterAuth({
    ...(authOptions(env, resendMailer(env)) as unknown as BetterAuthOptions),
    database: prismaAdapter(db, { provider: "postgresql" }),
    databaseHooks: {
      user: {
        create: {
          // whatever the request said, a new account is an ordinary, enabled user: roles are set only by scripts/seed-super-admin.mjs and the admin panel
          before: async () => ({ data: { role: "user", disabled: false } }),
        },
      },
      session: {
        create: {
          // a disabled account cannot sign in (an existing session is refused by requireUser on its next request)
          before: async (session) => {
            const u = await db.user.findUnique({ where: { id: session.userId }, select: { disabled: true } });
            if (u?.disabled) throw new APIError("FORBIDDEN", { message: "account_disabled" });
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof create> | null = null;

/** The shared instance. Throws AuthConfigError when BETTER_AUTH_SECRET is missing or too short (callers answer 503). */
export function useAuth() {
  return (instance ??= create());
}
