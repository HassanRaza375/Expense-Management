// The sync flag (NUXT_PUBLIC_SYNC_ENABLED). Everything that talks to the server (accounts, sync, photos, receipts, the admin panel) is behind it, in the browser and on the
// server. Only `1` and `true` mean on: anything else, including a missing value, means off. The same function is used by the app and by the server routes,
// so the two cannot disagree about what "on" means.
export function isSyncOn(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true";
}
