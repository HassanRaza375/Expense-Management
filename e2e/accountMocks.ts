import type { Page, Route } from "@playwright/test";
import { deflateSync } from "node:zlib";

// The browser tests never reach a real service. These helpers (1) turn the build-time sync flag ON in the browser, because the test build is made with it off, and
// (2) answer every /api/ request from an in-memory fake of the account server, so the Account area can be tested end to end, including the failure states.
// Tests that use them must run with the service worker blocked (`test.use({ serviceWorkers: "block" })`) so the page requests can be intercepted.

/** Makes the app believe accounts are turned on: the flag is part of the prerendered shell's config, so the document is rewritten on its way in. */
export async function enableAccountsInBrowser(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:\d+\/(?!api\/|_nuxt\/)[^?]*$/, async (route) => {
    const req = route.request();
    if (req.resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace("syncEnabled:0", "syncEnabled:1").replace("syncEnabled:false", "syncEnabled:true");
    const headers = { ...response.headers() };
    delete headers["content-encoding"];
    delete headers["content-length"];
    await route.fulfill({ status: response.status(), headers, body });
  });
}

export interface FakeUser {
  id: string;
  name: string;
  email: string;
  password: string;
  hasPhoto: boolean;
  role: string;
}

export interface Recorded {
  method: string;
  path: string;
  body: string;
  bytes: number;
  contentType: string;
}

export interface FakeServer {
  users: Map<string, FakeUser>;
  /** the signed-in user's email, or null */
  session: string | null;
  features: { google: boolean; email: boolean; passwordMin: number };
  requests: Recorded[];
  /** answer every /api/ call as if the network were down */
  offline: boolean;
  /** answer every /api/ call with this status instead (an account service that is not available) */
  down: number | null;
  /** how the next sign-in is refused (a rate limit) */
  rateLimitSignIn: boolean;
  /** the file a photo upload sent last */
  lastPhoto: { size: number; type: string; isJpeg: boolean } | null;
  signUpNeedsVerification: boolean;
}

export function fakeServer(over: Partial<FakeServer> = {}): FakeServer {
  return { users: new Map(), session: null, features: { google: false, email: false, passwordMin: 10 }, requests: [], offline: false, down: null, rateLimitSignIn: false, lastPhoto: null, signUpNeedsVerification: false, ...over };
}

/** The fields the fake server reads from a request body. */
interface Body {
  name?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
  confirm?: string;
}

let counter = 0;

/** Answers /api/* from `server`. Returns the same object so a test can read `requests` and change `session`. */
export async function installFakeAccountServer(page: Page, server: FakeServer = fakeServer()): Promise<FakeServer> {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const buf = req.postDataBuffer();
    server.requests.push({ method: req.method(), path, body: buf && buf.length < 4096 ? buf.toString("utf8") : "", bytes: buf?.length ?? 0, contentType: req.headers()["content-type"] ?? "" });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (server.offline) return route.abort("failed");
    if (server.down) return json(server.down, { error: "unavailable" });

    const me = server.session ? server.users.get(server.session) : undefined;
    const profile = (u: FakeUser) => ({ id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.hasPhoto ? `${url.origin}/pwa-192x192.png` : null });
    const body = (): Body => {
      try {
        return JSON.parse(buf?.toString("utf8") || "{}");
      } catch {
        return {};
      }
    };
    const m = req.method();

    if (path === "/api/account/status" && m === "GET") return json(200, server.features);
    if (path === "/api/account/session" && m === "GET") return json(200, { profile: me ? profile(me) : null });
    if (path === "/api/account" && m === "GET") return me ? json(200, profile(me)) : json(401, { error: "unauthenticated" });

    if (path === "/api/auth/sign-up/email" && m === "POST") {
      const b = body();
      if (String(b.password ?? "").length < 10) return json(400, { code: "PASSWORD_TOO_SHORT", message: "Password too short" });
      if (server.users.has(String(b.email).toLowerCase())) return json(422, { code: "USER_ALREADY_EXISTS", message: "exists" });
      const u: FakeUser = { id: `fake-${++counter}`, name: b.name, email: String(b.email).toLowerCase(), password: b.password, hasPhoto: false, role: "user" };
      server.users.set(u.email, u);
      if (!server.signUpNeedsVerification) server.session = u.email;
      return json(200, { token: server.signUpNeedsVerification ? null : "t", user: { id: u.id } });
    }
    if (path === "/api/auth/sign-in/email" && m === "POST") {
      if (server.rateLimitSignIn) return json(429, { message: "Too many requests. Please try again later." });
      const b = body();
      const u = server.users.get(String(b.email).toLowerCase());
      if (!u || u.password !== b.password) return json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
      server.session = u.email;
      return json(200, { token: "t", user: { id: u.id } });
    }
    if (path === "/api/auth/sign-out" && m === "POST") {
      server.session = null;
      return json(200, { success: true });
    }
    if (!me) return json(401, { error: "unauthenticated" });

    if (path === "/api/auth/update-user" && m === "POST") {
      me.name = String(body().name);
      return json(200, { status: true });
    }
    if (path === "/api/auth/change-password" && m === "POST") {
      const b = body();
      if (b.currentPassword !== me.password) return json(400, { code: "INVALID_PASSWORD", message: "Invalid password" });
      me.password = b.newPassword;
      return json(200, { status: true });
    }
    if (path === "/api/account/avatar" && m === "POST") {
      const head = buf?.subarray(0, 3);
      server.lastPhoto = { size: buf?.length ?? 0, type: req.headers()["content-type"] ?? "", isJpeg: !!head && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff };
      if (!server.lastPhoto.isJpeg) return json(415, { error: "not_an_image" });
      me.hasPhoto = true;
      return json(200, profile(me));
    }
    if (path === "/api/account/avatar" && m === "DELETE") {
      me.hasPhoto = false;
      return json(200, profile(me));
    }
    if (path === "/api/account" && m === "DELETE") {
      if (String(body().confirm).trim().toLowerCase() !== me.email) return json(400, { error: "confirmation_mismatch" });
      server.users.delete(me.email);
      server.session = null;
      return json(200, { deleted: true, filesRemoved: 0, cleanup: "done" });
    }
    return json(404, { error: "not_found" });
  });
  return server;
}

/** A valid PNG of the given size (a gradient), made without any library: for choosing a "photo" in a test. */
export function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = (x * 255) / width;
      raw[row + 2 + x * 3] = (y * 255) / height;
      raw[row + 3 + x * 3] = 128;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
