// Guest or account: which storage the app uses on this device. Guest mode is today's app. Signed in, the synced keys live in a per-user cache in localStorage
// (`hisaab:u:<userId>:<key>`, synchronous and as durable as the guest data), the guest data is left exactly where it was, and the base copies live in IndexedDB.
//
// The mode is decided at STARTUP, before any composable loads (`runStartup`): a hint of who was last signed in (`hisaab:auth:hint`) plus a "ready" marker that says this
// device finished its first sign-in choice for that user. Signing in or out reloads the page into the other mode, because composables read their storage once.
import { splitAll } from "./adapters";
import { useUserCache } from "../../utils/storage.js";

const PREFIX = "hisaab:";
export const HINT_KEY = `${PREFIX}auth:hint`;

export interface Hint {
  userId: string;
  email: string;
}

export const userKey = (userId: string, key: string): string => `${PREFIX}u:${userId}:${key}`;
export const readyKey = (userId: string): string => userKey(userId, "sync:ready");

function readJson(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function readHint(storage: Storage = localStorage): Hint | null {
  const v = readJson(storage, HINT_KEY) as Partial<Hint> | undefined;
  return v && typeof v.userId === "string" && v.userId && typeof v.email === "string" ? { userId: v.userId, email: v.email } : null;
}
export function writeHint(hint: Hint, storage: Storage = localStorage): void {
  storage.setItem(HINT_KEY, JSON.stringify(hint));
}
export function clearHint(storage: Storage = localStorage): void {
  storage.removeItem(HINT_KEY);
}

export const isReady = (userId: string, storage: Storage = localStorage): boolean => storage.getItem(readyKey(userId)) === "1";
export const markReady = (userId: string, storage: Storage = localStorage): void => storage.setItem(readyKey(userId), "1");

/** Removes this user's cache from the device (the account keeps its copy). The guest data is never touched. */
export function clearUserCache(userId: string, storage: Storage = localStorage): number {
  const prefix = userKey(userId, "");
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
  return doomed.length;
}

/** A guest value of a synced key, as the app stored it (undefined when absent or unreadable). */
export const guestRead = (key: string, storage: Storage = localStorage): unknown => readJson(storage, `${PREFIX}${key}`);

/** How many syncable records the guest data holds (the settings singleton counts as one when it exists). */
export function guestRecordCount(storage: Storage = localStorage): number {
  let n = 0;
  for (const records of splitAll((k) => guestRead(k, storage)).values()) n += records.size;
  return n;
}

/**
 * Called by the startup, before any composable loads. Returns the hint when this device is in ACCOUNT mode (accounts on, someone signed in, the first-sign-in choice
 * done) and points the storage wrapper at that user's cache; otherwise the app stays in guest mode.
 */
export function activateIfSignedIn(accountsOn: boolean, storage: Storage = localStorage): Hint | null {
  if (!accountsOn) return null;
  const hint = readHint(storage);
  if (!hint || !isReady(hint.userId, storage)) return null;
  useUserCache(hint.userId);
  return hint;
}
