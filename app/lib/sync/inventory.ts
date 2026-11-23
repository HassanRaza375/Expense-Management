// Every key the app keeps in localStorage is classified: `synced` (it travels to the account) or `device-only` (it never does). A test fails if a key is neither
// (tests/syncInventory.test.ts), so a new key cannot be added without deciding what sync does with it (D18).
import { ADAPTERS } from "./adapters";

export type KeyClass = "synced" | "device-only" | "unknown";

export const SYNCED_KEYS: string[] = ADAPTERS.map((a) => a.key);

/** Device-only, with the reason. */
export const DEVICE_ONLY_KEYS: Record<string, string> = {
  meta: "this device's data version",
  applock: "the screen lock: a lock a server could reset would not be a lock (D20)",
  "ui:sidebarOpen": "this device's layout",
  "auth:hint": "who was last signed in on this device",
  "session-unlocked": "the screen-lock session flag (sessionStorage)",
};

/** Device-only families: preserved unreadable copies, per-user caches of synced data, and sync bookkeeping. */
export const DEVICE_ONLY_PATTERNS: RegExp[] = [/^corrupt:/, /^u:[^:]+:/, /^sync:/];

/** The class of a storage key (with or without the `hisaab:` prefix). */
export function classify(key: string): KeyClass {
  const k = key.startsWith("hisaab:") ? key.slice("hisaab:".length) : key;
  if (SYNCED_KEYS.includes(k)) return "synced";
  if (Object.prototype.hasOwnProperty.call(DEVICE_ONLY_KEYS, k) || DEVICE_ONLY_PATTERNS.some((re) => re.test(k))) return "device-only";
  return "unknown";
}
