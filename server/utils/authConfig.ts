// The Better Auth options that depend only on the environment. Pure (no database, no network), so unit tests check them with fake environments.
// Everything is read from the environment at REQUEST time, never through runtimeConfig (a build-time copy of a secret lands in the build output).
//
// Off until their keys exist (the Account page says so): Google sign-in (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) and every email feature
// (RESEND_API_KEY + EMAIL_FROM: verify address, reset password). With them off, an account works with email + password only and is signed in right after sign-up.

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;
export const MIN_SECRET = 32;

export type Env = Record<string, string | undefined>;

export class AuthConfigError extends Error {
  code = "AUTH_UNCONFIGURED";
}

const set = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

export const googleEnabled = (env: Env): boolean => set(env.GOOGLE_CLIENT_ID) && set(env.GOOGLE_CLIENT_SECRET);
export const emailEnabled = (env: Env): boolean => set(env.RESEND_API_KEY) && set(env.EMAIL_FROM);

/** What the Account page may be told (booleans only, never a key). */
export const featureFlags = (env: Env) => ({ google: googleEnabled(env), email: emailEnabled(env), passwordMin: MIN_PASSWORD });

/** The signing secret, or an AuthConfigError that says (without the value) what is wrong. */
export function secretOf(env: Env): string {
  const s = env.BETTER_AUTH_SECRET;
  if (!set(s)) throw new AuthConfigError("BETTER_AUTH_SECRET is not set");
  if (s.length < MIN_SECRET) throw new AuthConfigError(`BETTER_AUTH_SECRET is shorter than ${MIN_SECRET} characters`);
  return s;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** The rate limits, per client address and path, stored in the database (a serverless host has no shared memory). Sign-in and sign-up are the slow ones. */
export const RATE_LIMITS = {
  window: 60,
  max: 60,
  customRules: {
    "/sign-in/email": { window: 60, max: 5 },
    "/sign-up/email": { window: 3600, max: 10 },
    "/request-password-reset": { window: 3600, max: 5 },
    "/forget-password": { window: 3600, max: 5 },
    "/reset-password": { window: 3600, max: 10 },
    "/send-verification-email": { window: 3600, max: 5 },
    "/change-password": { window: 3600, max: 10 },
  },
} as const;

/** The options for `betterAuth(...)` that come from the environment. `mailer` is only called when the email feature is on. */
export function authOptions(env: Env, mailer?: Mailer) {
  const baseURL = set(env.BETTER_AUTH_URL) ? env.BETTER_AUTH_URL.trim().replace(/\/+$/, "") : undefined;
  const mail = emailEnabled(env) ? mailer : undefined;
  return {
    appName: "Hisaab",
    secret: secretOf(env),
    ...(baseURL ? { baseURL, trustedOrigins: [baseURL] } : {}),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: MAX_PASSWORD,
      // verification is demanded only when there is a way to send the email: otherwise nobody could ever sign in
      requireEmailVerification: Boolean(mail),
      autoSignIn: !mail,
      revokeSessionsOnPasswordReset: true,
      ...(mail
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) =>
              mail.send({ to: user.email, subject: "Reset your Hisaab password", text: `Open this link to choose a new password (it expires in one hour):\n\n${url}\n\nIf you did not ask for this, ignore this message.` }),
          }
        : {}),
    },
    ...(mail
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) =>
              mail.send({ to: user.email, subject: "Confirm your Hisaab email address", text: `Open this link to confirm your address:\n\n${url}\n\nIf you did not create a Hisaab account, ignore this message.` }),
          },
        }
      : {}),
    ...(googleEnabled(env)
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID as string,
              clientSecret: env.GOOGLE_CLIENT_SECRET as string,
              // the Google photo is NEVER imported: the user chooses their own photo (or keeps the generated one)
              mapProfileToUser: () => ({ image: null }),
            },
          },
        }
      : {}),
    user: {
      additionalFields: {
        // set only by scripts/seed-super-admin.mjs and the admin panel's server code, never by a request body (input: false)
        role: { type: "string", required: false, defaultValue: "user", input: false },
        disabled: { type: "boolean", required: false, defaultValue: false, input: false },
        avatarPublicId: { type: "string", required: false, input: false },
        avatarVersion: { type: "number", required: false, input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 }, // no cookie cache: a disabled account or a role change takes effect on the next request
    rateLimit: { enabled: true, storage: "database", ...RATE_LIMITS },
    advanced: { useSecureCookies: env.NODE_ENV === "production", ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] } },
  } as const;
}
