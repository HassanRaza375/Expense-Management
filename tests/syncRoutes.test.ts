import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";
import { requireSync } from "../server/utils/syncRoutes";

// The checks every sync route makes right after the session. Found by the live check (scripts/live/sync.mjs): a refusal the service layer throws (ServiceError) is not
// an HTTP error, so unless the route translates it the caller gets a 500 instead of the 409 it means.
const event = (headers: Record<string, string>): H3Event => ({ node: { req: { headers } }, method: "POST", path: "/api/sync/push" }) as unknown as H3Event;
const refusal = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    const h3 = e as { statusCode?: number; data?: { error?: string } };
    return { status: h3.statusCode, error: h3.data?.error };
  }
  return null;
};

describe("requireSync", () => {
  const ok = { "x-hisaab-schema": "3", "x-hisaab-account": "user-1" };

  it("passes when the data version and the account are the ones the session has", () => {
    expect(refusal(() => requireSync(event(ok), "user-1"))).toBeNull();
  });

  it("a wrong or missing data version is a JSON 409 schema_mismatch, not a 500", () => {
    for (const v of [undefined, "", "2", "4", "three"]) {
      const headers = { ...ok } as Record<string, string>;
      if (v === undefined) delete headers["x-hisaab-schema"];
      else headers["x-hisaab-schema"] = v;
      expect(refusal(() => requireSync(event(headers), "user-1")), String(v)).toEqual({ status: 409, error: "schema_mismatch" });
    }
  });

  it("naming another account, or none, is a 409 account_mismatch: a browser holding one person's cache cannot push it into another's account", () => {
    expect(refusal(() => requireSync(event({ ...ok, "x-hisaab-account": "user-2" }), "user-1"))).toEqual({ status: 409, error: "account_mismatch" });
    expect(refusal(() => requireSync(event({ "x-hisaab-schema": "3" }), "user-1"))).toEqual({ status: 409, error: "account_mismatch" });
    expect(refusal(() => requireSync(event({ ...ok, "x-hisaab-account": "" }), "user-1"))).toEqual({ status: 409, error: "account_mismatch" });
  });

  it("the data version is checked before the account", () => {
    expect(refusal(() => requireSync(event({ "x-hisaab-schema": "9", "x-hisaab-account": "user-2" }), "user-1"))?.error).toBe("schema_mismatch");
  });
});
