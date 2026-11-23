import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { ServiceError } from "../server/utils/accountService";
import type { MediaStore } from "../server/utils/media";
import { cleanupReceipts, receiptUrl, uploadReceipt } from "../server/utils/receiptService";
import { adminAudit, adminExpenses, adminIncome, adminInvestments, adminOverview, adminStorage, adminUserDetail, adminUsers, deleteUser, sendResetEmail, updateUser, type AdminDeps } from "../server/utils/adminService";
import { fakeAdminRepo } from "../tests/fakes/adminRepo";
import { applyPush, pullSince, summaryOf } from "../server/utils/syncService";
import { fakeSyncRepo } from "../tests/fakes/syncRepo";
import { forbidRealServices } from "./fixtures";

// The browser tests never reach a real service. These helpers (1) turn the build-time sync flag ON in the browser, because the test build is made with it off, and
// (2) answer every /api/ request from an in-memory fake of the account server, so the Account area can be tested end to end, including the failure states.
// Tests that use them must run with the service worker blocked (`test.use({ serviceWorkers: "block" })`) so the page requests can be intercepted.

/** Makes the app believe accounts are turned on: the flag is part of the prerendered shell's config, so the document is rewritten on its way in. */
export async function enableAccountsInBrowser(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:\d+\/(?!api\/|_nuxt\/)/, async (route) => {
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
  /** the account's records: the REAL server rules (server/utils/syncService.ts) over the in-memory repository */
  repo: ReturnType<typeof fakeSyncRepo>;
  /** every sync request that reached the fake server, "METHOD path" */
  syncCalls: string[];
  /** answer every sync request as if this app were older than the server (409 schema_mismatch) */
  forceSchemaMismatch: boolean;
  /** the receipt files the fake account storage holds (public id -> size), and the ones removed from it */
  files: Map<string, number>;
  destroyed: string[];
  /** the admin side (created on first use): the REAL admin rules over an in-memory repository that mirrors `users` and `repo` */
  admin?: ReturnType<typeof fakeAdminRepo>;
  /** pretend the reset email is set up */
  emailSetUp?: boolean;
}

/** One browser (a device) of a test: its own storage, and a switch that cuts only its own network. */
export interface DeviceNet {
  offline: boolean;
  /** this device's own signed-in user's email (undefined = use the server-wide `session`, as the single-device tests do) */
  session?: string | null;
}

export function fakeServer(over: Partial<FakeServer> = {}): FakeServer {
  return { users: new Map(), session: null, features: { google: false, email: false, passwordMin: 10 }, requests: [], offline: false, down: null, rateLimitSignIn: false, lastPhoto: null, signUpNeedsVerification: false, repo: fakeSyncRepo(), syncCalls: [], forceSchemaMismatch: false, files: new Map(), destroyed: [], ...over };
}

/** The fields the fake server reads from a request body. */
interface Body {
  confirm?: string | boolean;
  name?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
}

let counter = 0;

/** Answers /api/* from `server`. Returns the same object so a test can read `requests` and change `session`. */
export async function installFakeAccountServer(page: Page, server: FakeServer = fakeServer(), net: DeviceNet = { offline: false }): Promise<FakeServer> {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const buf = req.postDataBuffer();
    server.requests.push({ method: req.method(), path, body: buf && buf.length < 4096 ? buf.toString("utf8") : "", bytes: buf?.length ?? 0, contentType: req.headers()["content-type"] ?? "" });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (server.offline || net.offline) return route.abort("failed");
    if (server.down) return json(server.down, { error: "unavailable" });

    const sessionEmail = (): string | null => (net.session !== undefined ? net.session : server.session);
    const setSession = (v: string | null) => {
      if (net.session !== undefined) net.session = v;
      else server.session = v;
    };
    const current = sessionEmail();
    const me = current ? server.users.get(current) : undefined;
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
      if (!server.signUpNeedsVerification) setSession(u.email);
      return json(200, { token: server.signUpNeedsVerification ? null : "t", user: { id: u.id } });
    }
    if (path === "/api/auth/sign-in/email" && m === "POST") {
      if (server.rateLimitSignIn) return json(429, { message: "Too many requests. Please try again later." });
      const b = body();
      const u = server.users.get(String(b.email).toLowerCase());
      if (!u || u.password !== b.password) return json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
      setSession(u.email);
      return json(200, { token: "t", user: { id: u.id } });
    }
    if (path === "/api/auth/sign-out" && m === "POST") {
      setSession(null);
      return json(200, { success: true });
    }
    // the admin routes answer 404 to everyone who is not a signed-in super admin (signed out too), before the generic sign-in check
    if (path.startsWith("/api/admin")) {
      // to everyone who is not a signed-in super admin: 404, exactly like an address that does not exist
      if (!me || me.role !== "superadmin") return json(404, { error: "not_found" });
      const repo = (server.admin ??= fakeAdminRepo(server.repo));
      for (const u of server.users.values()) if (!repo.accounts.has(u.id)) repo.add({ id: u.id, email: u.email, name: u.name, role: u.role });
      for (const id of [...repo.accounts.keys()]) if (![...server.users.values()].some((u) => u.id === id)) repo.accounts.delete(id);
      for (const u of server.users.values()) Object.assign(repo.accounts.get(u.id)!, { email: u.email, name: u.name, role: u.role });
      const deps: AdminDeps = { repo, media: null, sendReset: server.emailSetUp ? async () => undefined : null };
      const actor = { id: me.id, email: me.email };
      const seg = path.split("/").slice(3);
      const q = url.searchParams;
      try {
        if (m === "GET" && seg[0] === "overview") return json(200, await adminOverview(deps));
        if (m === "GET" && seg[0] === "users" && seg.length === 1) return json(200, await adminUsers(deps, { search: q.get("search") ?? undefined, role: q.get("role") ?? undefined, status: q.get("status") ?? undefined, page: Number(q.get("page")) }));
        if (m === "GET" && seg[0] === "users" && seg.length === 2) return json(200, await adminUserDetail(deps, decodeURIComponent(seg[1]!)));
        if (m === "PATCH" && seg[0] === "users" && seg.length === 2) {
          const out = await updateUser(deps, actor, decodeURIComponent(seg[1]!), body());
          // the fake server's own users follow the repository (name, email, role, disabled)
          const a = repo.accounts.get(decodeURIComponent(seg[1]!))!;
          const fu = [...server.users.values()].find((u) => u.id === a.id);
          if (fu) Object.assign(fu, { name: a.name, role: a.role });
          return json(200, out);
        }
        if (m === "DELETE" && seg[0] === "users" && seg.length === 2) {
          const id = decodeURIComponent(seg[1]!);
          const email = repo.accounts.get(id)?.email;
          const out = await deleteUser(deps, actor, id, body().confirm);
          if (email) server.users.delete(email);
          return json(200, out);
        }
        if (m === "POST" && seg[0] === "users" && seg[2] === "reset-email") return json(200, await sendResetEmail(deps, actor, decodeURIComponent(seg[1]!)));
        if (m === "GET" && seg[0] === "expenses") return json(200, await adminExpenses(deps, q.get("userId") ?? undefined));
        if (m === "GET" && seg[0] === "income") return json(200, await adminIncome(deps, q.get("userId") ?? undefined));
        if (m === "GET" && seg[0] === "investments") return json(200, await adminInvestments(deps, q.get("userId") ?? undefined));
        if (m === "GET" && seg[0] === "storage") return json(200, await adminStorage(deps));
        if (m === "GET" && seg[0] === "audit") return json(200, await adminAudit(deps, Number(q.get("page"))));
      } catch (e) {
        if (e instanceof ServiceError) return json(e.status, { error: e.code });
        throw e;
      }
      return json(404, { error: "not_found" });
    }
    if (!me) return json(401, { error: "unauthenticated" });

    if (path.startsWith("/api/receipts")) {
      // the REAL receipt rules (server/utils/receiptService.ts) over the same in-memory account, with a fake file store
      const media: MediaStore = {
        cloudName: "demo",
        root: "hisaab-test",
        uploadImage: async () => ({ publicId: "x", version: 1, bytes: 1 }),
        uploadReceipt: async ({ publicId, bytes }) => (server.files.set(publicId, bytes.length), { publicId, version: 1, bytes: bytes.length }),
        signedUrl: (publicId, { format, expiresInSeconds }) => `${url.origin}/pwa-192x192.png?pid=${encodeURIComponent(publicId)}&format=${format}&expires=${expiresInSeconds}`,
        listReceipts: async (prefix) => [...server.files].filter(([p]) => p.startsWith(prefix + "/")).map(([publicId, bytes]) => ({ publicId, bytes })),
        destroy: async (publicId) => void (server.files.delete(publicId), server.destroyed.push(publicId)),
        deleteByPrefix: async () => 0,
      };
      const deps = { repo: server.repo, media };
      const user = { id: me.id, email: me.email, name: me.name, role: me.role };
      const rid = decodeURIComponent(path.split("/")[3] ?? "");
      try {
        if (m === "PUT" && rid) return json(200, await uploadReceipt(deps, user, rid, new Uint8Array(buf ?? Buffer.alloc(0))));
        if (m === "GET" && rid) return json(200, await receiptUrl(deps, user, rid));
        if (m === "POST" && path === "/api/receipts/cleanup") return json(200, await cleanupReceipts(deps, user, body().confirm === true));
      } catch (e) {
        if (e instanceof ServiceError) return json(e.status, { error: e.code });
        throw e;
      }
      return json(404, { error: "not_found" });
    }

    if (path.startsWith("/api/sync/")) {
      server.syncCalls.push(`${m} ${path}`);
      const h = req.headers();
      if (server.forceSchemaMismatch || h["x-hisaab-schema"] !== "3") return json(409, { error: "schema_mismatch" });
      if (h["x-hisaab-account"] !== me.id) return json(409, { error: "account_mismatch" });
      try {
        const raw = buf?.toString("utf8") || "{}";
        if (path === "/api/sync/push" && m === "POST") return json(200, await applyPush(server.repo, me.id, JSON.parse(raw)));
        if (path === "/api/sync/pull" && m === "POST") return json(200, await pullSince(server.repo, me.id, JSON.parse(raw).since));
        if (path === "/api/sync/summary" && m === "GET") return json(200, await summaryOf(server.repo, me.id));
      } catch (e) {
        if (e instanceof ServiceError) return json(e.status, { error: e.code });
        throw e;
      }
      return json(404, { error: "not_found" });
    }

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
      setSession(null);
      return json(200, { deleted: true, filesRemoved: 0, cleanup: "done" });
    }
    return json(404, { error: "not_found" });
  });
  return server;
}

/** A user of the fake server, signed up before the test starts. */
export function addUser(server: FakeServer, email: string, password = "a-long-password-1", name = "Reader", role = "user"): FakeUser {
  const u: FakeUser = { id: `fake-${++counter}`, name, email, password, hasPhoto: false, role };
  server.users.set(email, u);
  return u;
}

export interface Device {
  context: BrowserContext;
  page: Page;
  net: DeviceNet;
  /** console errors and page errors of this device (the shared guard only covers the default context) */
  problems: string[];
  /** requests that tried to leave this machine */
  blocked: string[];
}

/**
 * A second (or third) device: its own browser context, so its own localStorage and IndexedDB, talking to the SAME fake account server. `initScript` seeds its guest data.
 * Console errors are collected in `problems` (an offline test expects some: it passes the patterns to allow).
 */
export async function newDevice(browser: Browser, server: FakeServer, opts: { initScript?: string; allow?: RegExp[]; viewport?: { width: number; height: number } } = {}): Promise<Device> {
  const context = await browser.newContext({ baseURL: "http://localhost:3011", timezoneId: "Asia/Karachi", serviceWorkers: "block", viewport: opts.viewport ?? { width: 1280, height: 900 } });
  const blocked = await forbidRealServices(context);
  if (opts.initScript) await context.addInitScript(opts.initScript);
  const page = await context.newPage();
  const net: DeviceNet = { offline: false, session: null }; // its own session: signing in on one device does not sign in the other
  await enableAccountsInBrowser(page);
  await installFakeAccountServer(page, server, net);
  const problems: string[] = [];
  const allow = [/Service Worker registration blocked by Playwright/, ...(opts.allow ?? [])];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !allow.some((re) => re.test(m.text()))) problems.push(`[${m.type()}] ${m.text()}`);
  });
  return { context, page, net, problems, blocked };
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
