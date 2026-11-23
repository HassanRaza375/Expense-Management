// The browser's side of the account routes: one fetch wrapper that turns every failure into an ApiError with a code, and the plain-language message for each code.
// Same-origin only, cookies are the session. Nothing here stores a password or a token.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Calls the server. `offline` (status 0) when the network is unreachable. Refusals carry the server's code (`{ error }`, or Better Auth's `{ code }`). */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "offline");
  }
  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; code?: string };
    throw new ApiError(res.status, b.error ?? b.code ?? (res.status === 429 ? "RATE_LIMITED" : "error"));
  }
  return body as T;
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const MESSAGES: Record<string, string> = {
  offline: "You seem to be offline. Try again when you are connected.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match.",
  INVALID_PASSWORD: "That password is not correct.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Try signing in.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Try signing in.",
  PASSWORD_TOO_SHORT: "Use a longer password (at least 10 characters).",
  PASSWORD_TOO_LONG: "That password is too long (at most 128 characters).",
  INVALID_EMAIL: "That does not look like an email address.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first: look for our message in your inbox.",
  FAILED_TO_CREATE_USER: "The account could not be created. Try again.",
  account_disabled: "This account has been disabled. Ask the person who runs this service.",
  FORBIDDEN: "This account has been disabled. Ask the person who runs this service.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  unauthenticated: "You are signed out. Sign in again.",
  confirmation_mismatch: "That is not the email address of this account.",
  last_super_admin: "This is the only super admin account. Make another one first.",
  photo_too_large: "That photo is too large.",
  not_an_image: "That file is not a JPEG, PNG or WebP picture.",
  empty_file: "No photo was sent.",
  media_unavailable: "Photos are not available right now.",
  unavailable: "The account service is not available right now.",
  not_found: "The account service is not turned on.",
  forbidden_origin: "That request was refused. Reload the page and try again.",
  too_large: "That request was too large.",
};

/** The message for an error: plain, says what to do, never shows a code or a server text. */
export function friendly(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? (e.status === 429 ? MESSAGES.RATE_LIMITED! : "Something went wrong. Try again.");
  return "Something went wrong. Try again.";
}
