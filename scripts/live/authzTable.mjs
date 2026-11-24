// Every file in server/api/**, with how it is reached and who may call it. Used by scripts/live/authz.mjs (which runs every row against the real server and database) and by
// tests/routeGuards.test.ts (which fails when a route file exists that is not in this table, so a new route cannot be added without an authorization check being written for it).
//   access "public"  anyone may call it (it holds no account data)
//   access "user"    a signed-in, enabled account; signed out is 401; the account acted on is ALWAYS the session's
//   access "admin"   a signed-in, enabled super admin; everyone else gets 404, as for an address that does not exist
// `{victim}` in a path is replaced by another account's id (admin routes) or by a receipt id that belongs to another account (receipt routes).
export const ROUTES = [
  { file: "health.get.ts", method: "GET", path: "/api/health", access: "public" },
  { file: "[...].ts", method: "GET", path: "/api/no-such-route", access: "public", publicStatus: 404 },
  { file: "auth/[...all].ts", method: "GET", path: "/api/auth/ok", access: "public" },
  { file: "account/status.get.ts", method: "GET", path: "/api/account/status", access: "public" },
  { file: "account/session.get.ts", method: "GET", path: "/api/account/session", access: "public" },
  { file: "account/index.get.ts", method: "GET", path: "/api/account", access: "user" },
  { file: "account/index.delete.ts", method: "DELETE", path: "/api/account", access: "user", body: { confirm: "nobody@example.test" } },
  { file: "account/avatar.post.ts", method: "POST", path: "/api/account/avatar", access: "user", raw: true },
  { file: "account/avatar.delete.ts", method: "DELETE", path: "/api/account/avatar", access: "user" },
  { file: "sync/push.post.ts", method: "POST", path: "/api/sync/push", access: "user", sync: true, body: { ops: [] } },
  { file: "sync/pull.post.ts", method: "POST", path: "/api/sync/pull", access: "user", sync: true, body: { since: 0 } },
  { file: "sync/summary.get.ts", method: "GET", path: "/api/sync/summary", access: "user", sync: true },
  { file: "receipts/[id].get.ts", method: "GET", path: "/api/receipts/{victim}", access: "user" },
  { file: "receipts/[id].put.ts", method: "PUT", path: "/api/receipts/{victim}", access: "user", raw: true },
  { file: "receipts/cleanup.post.ts", method: "POST", path: "/api/receipts/cleanup", access: "user", body: {} },
  { file: "admin/overview.get.ts", method: "GET", path: "/api/admin/overview", access: "admin" },
  { file: "admin/users.get.ts", method: "GET", path: "/api/admin/users", access: "admin" },
  { file: "admin/users/[id].get.ts", method: "GET", path: "/api/admin/users/{victim}", access: "admin" },
  { file: "admin/users/[id].patch.ts", method: "PATCH", path: "/api/admin/users/{victim}", access: "admin", body: { name: "forged" } },
  { file: "admin/users/[id].delete.ts", method: "DELETE", path: "/api/admin/users/{victim}", access: "admin", body: { confirm: "x" } },
  { file: "admin/users/[id]/reset-email.post.ts", method: "POST", path: "/api/admin/users/{victim}/reset-email", access: "admin", body: {} },
  { file: "admin/expenses.get.ts", method: "GET", path: "/api/admin/expenses", access: "admin" },
  { file: "admin/income.get.ts", method: "GET", path: "/api/admin/income", access: "admin" },
  { file: "admin/investments.get.ts", method: "GET", path: "/api/admin/investments", access: "admin" },
  { file: "admin/storage.get.ts", method: "GET", path: "/api/admin/storage", access: "admin" },
  { file: "admin/audit.get.ts", method: "GET", path: "/api/admin/audit", access: "admin" },
];

/** Headers a caller might invent to pass for someone else. None of them is read by the server. */
export const FORGED_HEADERS = (victimId) => ({
  "x-user-id": victimId,
  "x-userid": victimId,
  "x-user": victimId,
  "x-forwarded-user": victimId,
  "x-user-role": "superadmin",
  "x-role": "superadmin",
  "x-admin": "true",
  "x-hisaab-role": "superadmin",
});
