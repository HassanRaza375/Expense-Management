import { describe, expect, it, vi } from "vitest";
import { AuthConfigError, MIN_PASSWORD, MIN_SECRET, RATE_LIMITS, authOptions, emailEnabled, featureFlags, googleEnabled, secretOf } from "../server/utils/authConfig";
import { resendMailer } from "../server/utils/mailer";
import { sameOriginOk } from "../server/utils/origin";

// the parts of the options these tests look into, typed loosely on purpose (the real options type is the library's)
interface Loose {
  baseURL?: string;
  trustedOrigins?: string[];
  session: { cookieCache?: unknown };
  emailAndPassword: {
    requireEmailVerification: boolean;
    autoSignIn: boolean;
    minPasswordLength: number;
    maxPasswordLength: number;
    sendResetPassword: (a: { user: { email: string }; url: string }) => Promise<void>;
  };
  emailVerification: { sendVerificationEmail: (a: { user: { email: string }; url: string }) => Promise<void> };
  socialProviders: { google: { mapProfileToUser: (p: object) => unknown } };
}
const loose = (o: unknown) => o as Loose;

const SECRET = "s".repeat(MIN_SECRET);
const base = { BETTER_AUTH_SECRET: SECRET };

describe("the signing secret", () => {
  it("is required and must be long enough, and the error never contains the value", () => {
    expect(() => secretOf({})).toThrow(AuthConfigError);
    expect(() => secretOf({ BETTER_AUTH_SECRET: "  " })).toThrow(AuthConfigError);
    try {
      secretOf({ BETTER_AUTH_SECRET: "tooshort-secret-value" });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("tooshort-secret-value");
    }
    expect(secretOf(base)).toBe(SECRET);
  });
});

describe("optional features are off until their keys exist", () => {
  it("Google needs both the id and the secret; email needs the key and a sender", () => {
    expect(googleEnabled({})).toBe(false);
    expect(googleEnabled({ GOOGLE_CLIENT_ID: "a" })).toBe(false);
    expect(googleEnabled({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toBe(true);
    expect(googleEnabled({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: " " })).toBe(false);
    expect(emailEnabled({ RESEND_API_KEY: "k" })).toBe(false);
    expect(emailEnabled({ RESEND_API_KEY: "k", EMAIL_FROM: "Hisaab <no-reply@example.test>" })).toBe(true);
  });

  it("the page is told booleans and the password length, never a key", () => {
    const f = featureFlags({ ...base, GOOGLE_CLIENT_ID: "id-123", GOOGLE_CLIENT_SECRET: "secret-456", RESEND_API_KEY: "re_789", EMAIL_FROM: "x@y.test" });
    expect(f).toEqual({ google: true, email: true, passwordMin: MIN_PASSWORD });
    expect(JSON.stringify(f)).not.toMatch(/id-123|secret-456|re_789|x@y/);
  });

  it("with nothing configured: email and password only, no verification demanded, signed in right after sign-up", () => {
    const o = authOptions(base);
    expect(o.emailAndPassword.enabled).toBe(true);
    expect(o.emailAndPassword.requireEmailVerification).toBe(false);
    expect(o.emailAndPassword.autoSignIn).toBe(true);
    expect("socialProviders" in o).toBe(false);
    expect("emailVerification" in o).toBe(false);
    expect("sendResetPassword" in o.emailAndPassword).toBe(false);
  });

  it("with email on: verification is required and reset sends through the mailer", async () => {
    const send = vi.fn(async () => undefined);
    const o = loose(authOptions({ ...base, RESEND_API_KEY: "k", EMAIL_FROM: "a@b.test" }, { send }));
    expect(o.emailAndPassword.requireEmailVerification).toBe(true);
    expect(o.emailAndPassword.autoSignIn).toBe(false);
    await o.emailAndPassword.sendResetPassword({ user: { email: "me@example.test" }, url: "https://app.test/reset?token=t" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "me@example.test", text: expect.stringContaining("https://app.test/reset?token=t") }));
    await o.emailVerification.sendVerificationEmail({ user: { email: "me@example.test" }, url: "https://app.test/verify" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("with a key but no mailer function, verification is NOT required (nobody could sign in otherwise)", () => {
    expect(authOptions({ ...base, RESEND_API_KEY: "k", EMAIL_FROM: "a@b.test" }).emailAndPassword.requireEmailVerification).toBe(false);
  });

  it("Google never imports the photo", () => {
    const o = loose(authOptions({ ...base, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }));
    expect(o.socialProviders.google.mapProfileToUser({ picture: "https://lh3.googleusercontent.com/x", name: "N" })).toEqual({ image: null });
  });
});

describe("the account's privileged fields cannot be set by a request", () => {
  const fields = authOptions(base).user.additionalFields;
  it("role, disabled and the photo fields are input: false", () => {
    for (const f of ["role", "disabled", "avatarPublicId", "avatarVersion"] as const) expect(fields[f].input, f).toBe(false);
    expect(fields.role.defaultValue).toBe("user");
    expect(fields.disabled.defaultValue).toBe(false);
  });
});

describe("limits and cookies", () => {
  it("rate limits are on, stored in the database, and slow down sign-in and sign-up hardest", () => {
    const o = authOptions(base);
    expect(o.rateLimit.enabled).toBe(true);
    expect(o.rateLimit.storage).toBe("database");
    expect(RATE_LIMITS.customRules["/sign-in/email"].max).toBeLessThanOrEqual(5);
    expect(RATE_LIMITS.customRules["/sign-up/email"].max).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.customRules["/request-password-reset"].max).toBeLessThanOrEqual(5);
  });

  it("passwords have a minimum and a maximum; sessions are not cached in the cookie (a disabled account stops at once)", () => {
    const o = loose(authOptions(base));
    expect(o.emailAndPassword.minPasswordLength).toBe(MIN_PASSWORD);
    expect(o.emailAndPassword.maxPasswordLength).toBe(128);
    expect(o.session.cookieCache).toBeUndefined();
  });

  it("cookies are Secure in production only, and the base URL (when set) is the one trusted origin", () => {
    expect(authOptions({ ...base, NODE_ENV: "production" }).advanced.useSecureCookies).toBe(true);
    expect(authOptions(base).advanced.useSecureCookies).toBe(false);
    const o = loose(authOptions({ ...base, BETTER_AUTH_URL: "https://hisaab.example.test/" }));
    expect(o.baseURL).toBe("https://hisaab.example.test");
    expect(o.trustedOrigins).toEqual(["https://hisaab.example.test"]);
    expect(authOptions(base).trustedOrigins).toBeUndefined();
  });

  it("the secret in the options is the environment's, and the options hold no other secret", () => {
    expect(authOptions(base).secret).toBe(SECRET);
  });
});

describe("the mailer", () => {
  it("posts to the provider with the key in a header and nothing else secret in the body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer({ RESEND_API_KEY: "re_KEY", EMAIL_FROM: "Hisaab <a@b.test>" }, fake).send({ to: "me@example.test", subject: "S", text: "T" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_KEY");
    expect(String(calls[0]!.init.body)).not.toContain("re_KEY");
  });

  it("a refusal from the provider is an error that does not contain the key or the address", async () => {
    const fake = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await expect(resendMailer({ RESEND_API_KEY: "re_KEY", EMAIL_FROM: "a@b.test" }, fake).send({ to: "me@example.test", subject: "S", text: "T" })).rejects.toThrow(/401/);
    try {
      await resendMailer({ RESEND_API_KEY: "re_KEY", EMAIL_FROM: "a@b.test" }, fake).send({ to: "me@example.test", subject: "S", text: "T" });
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/re_KEY|me@example/);
    }
  });
});

describe("sameOriginOk (CSRF guard)", () => {
  const host = "hisaab.example.test";
  it("lets safe methods through", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(sameOriginOk({ method, origin: "https://evil.test", host })).toBe(true);
  });
  it("lets a state-changing request through only from this site", () => {
    expect(sameOriginOk({ method: "POST", origin: `https://${host}`, host })).toBe(true);
    expect(sameOriginOk({ method: "DELETE", origin: `https://${host}`, host })).toBe(true);
    expect(sameOriginOk({ method: "POST", origin: "https://evil.test", host })).toBe(false);
    expect(sameOriginOk({ method: "POST", origin: `https://${host}.evil.test`, host })).toBe(false);
    expect(sameOriginOk({ method: "POST", origin: "not a url", host })).toBe(false);
    expect(sameOriginOk({ method: "POST", origin: `https://${host}`, host: null })).toBe(false);
  });
  it("without an Origin only the browser's own same-site signals count", () => {
    expect(sameOriginOk({ method: "POST", host, secFetchSite: "same-origin" })).toBe(true);
    expect(sameOriginOk({ method: "POST", host, secFetchSite: "none" })).toBe(true);
    expect(sameOriginOk({ method: "POST", host, secFetchSite: "cross-site" })).toBe(false);
    expect(sameOriginOk({ method: "POST", host, secFetchSite: "same-site" })).toBe(false);
    expect(sameOriginOk({ method: "POST", host })).toBe(false);
  });
});
