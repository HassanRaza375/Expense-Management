import { describe, expect, it } from "vitest";
import { defaultAvatarSvg, defaultAvatarUri, hash32 } from "../app/lib/account/avatar";
import { MAX_ZOOM, MIN_ZOOM, baseScale, centred, clampOffset, clampZoom, sourceRect, zoomAboutCentre } from "../app/lib/account/crop";
import { ApiError, apiFetch, friendly, jsonInit } from "../app/lib/account/api";

describe("the generated avatar", () => {
  it("is the same for the same seed and different for different seeds", () => {
    expect(defaultAvatarSvg("user-1")).toBe(defaultAvatarSvg("user-1"));
    expect(defaultAvatarSvg("user-1")).not.toBe(defaultAvatarSvg("user-2"));
    expect(hash32("a")).toBe(hash32("a"));
    expect(hash32("a")).not.toBe(hash32("b"));
  });
  it("is a safe, self-contained SVG: no script, no external reference, no text from the seed", () => {
    const seed = '"><script>alert(1)</script><image href="https://evil.test/x.png"/>';
    const svg = defaultAvatarSvg(seed);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script|href=|xlink|https?:\/\/(?!www\.w3\.org)|alert|evil/);
    const uri = defaultAvatarUri(seed);
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(uri).not.toContain("<");
  });
  it("works for an empty seed (a guest)", () => {
    expect(defaultAvatarSvg("")).toContain("<svg");
  });
  it("gives many different pictures (no collision among 200 ids)", () => {
    const set = new Set(Array.from({ length: 200 }, (_, i) => defaultAvatarSvg(`id-${i}`)));
    expect(set.size).toBe(200);
  });
});

describe("crop maths", () => {
  const wide = { imgW: 4000, imgH: 3000, view: 256 };
  const tall = { imgW: 1000, imgH: 3000, view: 256 };

  it("the base scale makes the image just cover the view", () => {
    expect(baseScale(4000, 3000, 256)).toBeCloseTo(256 / 3000);
    expect(baseScale(1000, 3000, 256)).toBeCloseTo(256 / 1000);
  });

  it("centres the image, and clamps so the picture always covers the view", () => {
    const c = centred(wide.imgW, wide.imgH, wide.view, 1);
    expect(c.y).toBeCloseTo(0); // the short side fits exactly
    expect(c.x).toBeLessThan(0);
    for (const zoom of [1, 1.7, 4]) {
      for (const [x, y] of [[999, 999], [-99999, -99999], [0, 0], [-50, 20]]) {
        for (const dims of [wide, tall]) {
          const o = clampOffset({ ...dims, zoom, x, y });
          const s = baseScale(dims.imgW, dims.imgH, dims.view) * zoom;
          expect(o.x).toBeLessThanOrEqual(1e-9);
          expect(o.y).toBeLessThanOrEqual(1e-9);
          expect(o.x + dims.imgW * s).toBeGreaterThanOrEqual(dims.view - 1e-6);
          expect(o.y + dims.imgH * s).toBeGreaterThanOrEqual(dims.view - 1e-6);
        }
      }
    }
  });

  it("zoom is limited", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("zooming keeps the centre of the view on the same part of the picture", () => {
    const start = { ...wide, zoom: 1, ...centred(wide.imgW, wide.imgH, wide.view, 1) };
    const s0 = baseScale(wide.imgW, wide.imgH, wide.view);
    const centreBefore = [(wide.view / 2 - start.x) / s0, (wide.view / 2 - start.y) / s0];
    const z = zoomAboutCentre(start, 2.5);
    const s1 = s0 * z.zoom;
    expect((wide.view / 2 - z.x) / s1).toBeCloseTo(centreBefore[0]!, 3);
    expect((wide.view / 2 - z.y) / s1).toBeCloseTo(centreBefore[1]!, 3);
  });

  it("the source rectangle is square, inside the picture, and shrinks as you zoom", () => {
    for (const dims of [wide, tall]) {
      for (const zoom of [1, 2, 4]) {
        const p = centred(dims.imgW, dims.imgH, dims.view, zoom);
        const r = sourceRect({ ...dims, zoom, ...p });
        expect(r.sw).toBeCloseTo(r.sh);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(dims.imgW + 1e-6);
        expect(r.sy + r.sh).toBeLessThanOrEqual(dims.imgH + 1e-6);
      }
    }
    const a = sourceRect({ ...wide, zoom: 1, ...centred(4000, 3000, 256, 1) });
    const b = sourceRect({ ...wide, zoom: 4, ...centred(4000, 3000, 256, 4) });
    expect(b.sw).toBeCloseTo(a.sw / 4);
  });

  it("a picture smaller than the view is still covered (scaled up)", () => {
    const r = sourceRect({ imgW: 100, imgH: 100, view: 256, zoom: 1, x: 0, y: 0 });
    expect(r).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });
});

describe("apiFetch and friendly messages", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the JSON of a success", async () => {
    expect(await apiFetch("/x", {}, reply(200, { a: 1 }))).toEqual({ a: 1 });
    expect(await apiFetch("/x", {}, reply(200, ""))).toBeNull();
  });
  it("a network failure is `offline` (status 0)", async () => {
    const down = (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    await expect(apiFetch("/x", {}, down)).rejects.toMatchObject({ status: 0, code: "offline" });
  });
  it("a refusal carries the server's code (ours `error`, Better Auth's `code`), and 429 is rate limited", async () => {
    await expect(apiFetch("/x", {}, reply(400, { error: "confirmation_mismatch" }))).rejects.toMatchObject({ status: 400, code: "confirmation_mismatch" });
    await expect(apiFetch("/x", {}, reply(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }))).rejects.toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    await expect(apiFetch("/x", {}, reply(429, { message: "Too many requests" }))).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    await expect(apiFetch("/x", {}, reply(502, "<html>bad gateway</html>"))).rejects.toMatchObject({ status: 502, code: "error" });
  });
  it("always sends cookies for this site only", async () => {
    let seen: RequestInit | undefined;
    await apiFetch("/x", { method: "POST" }, (async (_u: string, init: RequestInit) => ((seen = init), new Response("{}"))) as unknown as typeof fetch);
    expect(seen!.credentials).toBe("same-origin");
  });
  it("jsonInit sets the method, header and body", () => {
    expect(jsonInit("DELETE", { a: 1 })).toEqual({ method: "DELETE", headers: { "content-type": "application/json" }, body: '{"a":1}' });
  });
  it("every message is plain language, never a code, a status or server text", () => {
    for (const code of ["offline", "INVALID_EMAIL_OR_PASSWORD", "USER_ALREADY_EXISTS", "PASSWORD_TOO_SHORT", "account_disabled", "confirmation_mismatch", "photo_too_large", "not_an_image", "media_unavailable", "unavailable", "RATE_LIMITED"]) {
      const m = friendly(new ApiError(400, code));
      expect(m.length, code).toBeGreaterThan(10);
      expect(m, code).not.toMatch(/[A-Z_]{6,}|\b4\d\d\b|\b5\d\d\b/);
    }
    expect(friendly(new ApiError(429, "weird"))).toMatch(/Too many/);
    expect(friendly(new ApiError(500, "weird"))).toBe("Something went wrong. Try again.");
    expect(friendly(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});
