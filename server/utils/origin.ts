// CSRF guard for the routes that change something with the session cookie (the cookie is SameSite=Lax, this is the second layer).
// A browser sends `Origin` (and `Sec-Fetch-Site`) on every fetch that is not a plain GET. Safe methods pass; everything else must come from this site.
export interface OriginInput {
  method: string;
  origin?: string | null;
  host?: string | null;
  secFetchSite?: string | null;
}

export function sameOriginOk({ method, origin, host, secFetchSite }: OriginInput): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return true;
  if (origin) {
    try {
      return Boolean(host) && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  // no Origin: only a browser that says the request is from this site (or typed by the user)
  return secFetchSite === "same-origin" || secFetchSite === "none";
}
