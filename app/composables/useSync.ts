// Sync in the page: runs the engine while this device is in ACCOUNT mode, and drives the first sign-in, sign-out and account deletion around it.
//
// GUEST MODE IS TODAY'S APP: with accounts off, or signed out, nothing here calls the server and nothing is stored. Everything that changes data on the device is
// preceded by a safety snapshot, and the data of the guest storage (`hisaab:*`) is never changed by any of it.
import { reactive, readonly } from "vue";
import { SyncApiError, SyncEngine, type SyncReport } from "../lib/sync/engine";
import { httpSyncApi } from "../lib/sync/client";
import { idbBaseStore } from "../lib/sync/baseStore";
import { userLocalStore } from "../lib/sync/localStore";
import { clearHint, clearUserCache, guestRead, guestRecordCount, isReady, markReady, readHint, writeHint } from "../lib/sync/mode";
import { downloadBackupFile } from "../lib/sync/backupDownload";
import { singleFlight } from "../lib/sync/singleFlight";
import { isPermanentRefusal, tooLargeForAccount, waitingReceipts } from "../lib/sync/receiptQueue";
import { uploadReceiptFile } from "../lib/sync/receiptsApi";
import { ApiError, friendly } from "../lib/account/api";
import { getAttachment } from "../utils/attachments.js";
import { useExpenses } from "./useExpenses.js";
import { isUserCacheActive, onStorageChange } from "../utils/storage.js";
import { saveSnapshot } from "../utils/snapshots.js";
import { accountsEnabled, deleteAccount as deleteServerAccount, signOut as signOutServer, type Profile } from "./useAccount";

export type SyncStatus = "off" | "guest" | "idle" | "syncing" | "synced" | "offline" | "error" | "signedOut" | "mismatch" | "disabled" | "updateRequired" | "held";

export interface Choice {
  userId: string;
  email: string;
  deviceRecords: number;
  accountRecords: number;
  busy: boolean;
  error: string;
}

const state = reactive<{
  status: SyncStatus;
  pending: number;
  lastSyncAt: number | null;
  held: { deletes: number; of: number } | null;
  rejected: number;
  uploaded: number;
  message: string;
  choice: Choice | null;
  /** the receipt files going up to the account (they follow the records: a file is only accepted for a receipt the account already has) */
  uploads: { total: number; done: number; failed: number; message: string };
  /** true while the person is signed in but this device has not finished the first-sign-in choice */
  needsChoice: boolean;
}>({ status: "idle", pending: 0, lastSyncAt: null, held: null, rejected: 0, uploaded: 0, message: "", choice: null, uploads: { total: 0, done: 0, failed: 0, message: "" }, needsChoice: false });

let engine: SyncEngine | null = null;
let userId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let failures = 0;
let started = false;

const DEBOUNCE_MS = 1500;
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const reload = () => window.location.reload();

function makeEngine(id: string, live: boolean): SyncEngine {
  return new SyncEngine({ api: httpSyncApi(id), store: userLocalStore(id, { live }), bases: idbBaseStore(id) });
}

function describeError(kind: string): string {
  return (
    { offline: "You seem to be offline. Your changes are saved on this device and will go up when you are back online.", unauthenticated: "You are signed out. Sign in again to keep syncing; your changes are safe on this device.", disabled: "This account has been disabled. Ask the person who runs this service.", schema: "This copy of Hisaab is out of date. Reload the page to update it.", account: "Another account is signed in on this browser. Sign out and sign in again.", rate: "Too many requests. Sync will try again shortly.", server: "The account service is not available right now. Your changes are safe on this device; sync will try again." } as Record<string, string>
  )[kind] ?? "Sync could not finish. It will try again.";
}

function apply(report: SyncReport) {
  state.pending = report.pending;
  state.rejected = report.rejected.length;
  state.held = report.held;
  state.lastSyncAt = engine?.lastSync ?? Date.now();
  state.uploaded = engine?.uploaded.length ?? 0;
  failures = 0;
  state.message = report.rejected.length ? `${report.rejected.length} record${report.rejected.length === 1 ? " was" : "s were"} refused by the server and stay only on this device.` : "";
  state.status = report.held ? "held" : report.rejected.length ? "error" : report.pending > 0 ? "idle" : "synced";
}

function fail(e: unknown) {
  const kind = e instanceof SyncApiError ? e.kind : "server";
  state.pending = engine?.pending() ?? state.pending;
  state.message = describeError(kind);
  const map: Record<string, SyncStatus> = { offline: "offline", unauthenticated: "signedOut", account: "mismatch", disabled: "disabled", schema: "updateRequired", rate: "error", server: "error" };
  state.status = map[kind] ?? "error";
  if (kind === "offline" || kind === "rate" || kind === "server") schedule(BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)]);
}

const refusedReceipts = new Set<string>();
let uploadingReceipts = false;

/**
 * Sends the receipt files that are waiting (utils: receiptQueue.ts: derived, so an interrupted upload just continues next time). A file is marked `remote` once it is safely
 * there; the mark syncs. A refusal that will not change (too large, not a picture or PDF) leaves the file out for this session and says why; being offline or a server
 * problem stops the loop quietly and the next run continues.
 */
async function uploadReceipts(): Promise<void> {
  if (uploadingReceipts || !engine) return;
  const e = engine;
  const { expenses, markReceiptRemote } = useExpenses();
  const waiting = waitingReceipts(expenses, () => true, (id) => e.isSynced("receipt", id), refusedReceipts);
  if (!waiting.length) {
    if (!state.uploads.total || state.uploads.done + state.uploads.failed >= state.uploads.total) state.uploads = { total: 0, done: 0, failed: state.uploads.failed, message: state.uploads.message };
    return;
  }
  uploadingReceipts = true;
  state.uploads = { total: waiting.length, done: 0, failed: 0, message: "" };
  try {
    for (const w of waiting) {
      const id = w.receipt.id;
      const att = await getAttachment(id);
      if (!att?.blob) {
        refusedReceipts.add(id); // the file is not on this device: nothing to upload from here
        state.uploads.total--;
        continue;
      }
      if (tooLargeForAccount(att.blob.size)) {
        refusedReceipts.add(id);
        state.uploads.failed++;
        state.uploads.message = "A receipt is over 10 MB, so it stays only on this device.";
        continue;
      }
      try {
        await uploadReceiptFile(id, att.blob);
        markReceiptRemote(w.expenseId, id);
        state.uploads.done++;
      } catch (err) {
        if (err instanceof ApiError && isPermanentRefusal(err.status, err.code)) {
          refusedReceipts.add(id);
          state.uploads.failed++;
          state.uploads.message = `A receipt could not be uploaded: ${friendly(err)} It stays on this device.`;
        } else {
          throw err; // offline or the service is having trouble: the rest waits
        }
      }
    }
  } catch {
    /* the remaining files go up on a later run */
  } finally {
    uploadingReceipts = false;
  }
}

/** One run at a time (in this tab, and across tabs where the Web Locks API exists). A request that arrives during a run is not lost: one more run follows it (singleFlight). */
const flight = singleFlight(async (opts) => {
  if (!engine || !userId) return;
  const e = engine;
  const run = async () => {
    state.status = "syncing";
    try {
      const report = await e.syncOnce(opts);
      apply(report);
      if (!report.held) await uploadReceipts();
    } catch (err) {
      fail(err);
    }
  };
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) await locks.request(`hisaab-sync-${userId}`, { ifAvailable: true }, async (lock) => (lock ? run() : undefined));
  else await run();
});

export function syncNow(opts: { allowMassDelete?: boolean } = {}): Promise<void> {
  if (!engine || !userId) return Promise.resolve();
  return flight.request(opts);
}

function schedule(ms = DEBOUNCE_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (state.status === "signedOut" || state.status === "mismatch" || state.status === "disabled" || state.status === "updateRequired") return; // needs the person first
    void syncNow();
  }, ms);
}

/** Starts the engine when this device is in account mode. Called once, by the layout, after the app has mounted. */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  if (!accountsEnabled()) {
    state.status = "off";
    return;
  }
  const hint = readHint();
  if (!isUserCacheActive() || !hint) {
    state.status = "guest";
    return;
  }
  userId = hint.userId;
  engine = makeEngine(hint.userId, true);
  const init = await engine.init();
  if (init.fresh) {
    // the data is here but its sync memory is not (the browser cleared it): keep a copy before the first merge, whose rule without a memory is "this device wins"
    await saveSnapshot("Before re-syncing this device with your account").catch(() => undefined);
  }
  state.lastSyncAt = engine.lastSync;
  state.uploaded = engine.uploaded.length;
  state.pending = engine.pending();
  onStorageChange(() => {
    state.pending = engine?.pending() ?? 0;
    // a change is waiting: do not keep saying "Synced" (the run starts after a short pause so a burst of edits goes up together)
    if (state.pending > 0 && state.status === "synced") state.status = "idle";
    schedule();
  });
  window.addEventListener("online", () => schedule(500));
  window.addEventListener("offline", () => {
    state.status = "offline";
    state.pending = engine?.pending() ?? 0;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule(500);
  });
  interval = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) schedule(0);
  }, 60_000);
  if (navigator.onLine === false) {
    state.status = "offline";
    return;
  }
  void syncNow();
}

export function stopSync(): void {
  if (timer) clearTimeout(timer);
  if (interval) clearInterval(interval);
  timer = interval = null;
}

/** Held deletes: the person confirms them, or restores the account's data instead. */
export const confirmHeld = (): Promise<void> => syncNow({ allowMassDelete: true });

export async function restoreFromAccount(): Promise<void> {
  if (!engine) return;
  stopSync();
  await saveSnapshot("Before restoring this device from your account");
  await engine.restoreFromAccount();
  reload();
}

export async function undoUpload(): Promise<number> {
  if (!engine) return 0;
  const r = await engine.undoUpload();
  state.uploaded = 0;
  state.pending = r.pending;
  return r.removed;
}

// ---- the first sign-in ----

/**
 * Called right after a successful sign-in or sign-up. Writes the hint of who signed in, then either continues (this device already has that account's data), or fills the
 * account's cache straight away (nothing on this device to upload), or opens the choice. Never merges anything by itself.
 */
export async function beginFirstSignIn(profile: Pick<Profile, "id" | "email">): Promise<"reloading" | "choice" | "resumed" | "blocked" | "off"> {
  if (!accountsEnabled()) return "off";
  const old = readHint();
  if (old && old.userId !== profile.id) {
    // this device still holds somebody else's cache: it is never mixed in, and never removed without them
    await signOutServer().catch(() => undefined);
    state.message = `This device still holds the data of ${old.email}. Sign in as that account to finish, or sign out of it first (that removes its copy from this device).`;
    return "blocked";
  }
  writeHint({ userId: profile.id, email: profile.email });
  if (isReady(profile.id)) {
    if (isUserCacheActive()) {
      userId = profile.id;
      engine ??= makeEngine(profile.id, true);
      await engine.init();
      state.status = "idle";
      schedule(0);
      return "resumed";
    }
    reload();
    return "reloading";
  }
  return openChoice(profile);
}

async function openChoice(profile: Pick<Profile, "id" | "email">): Promise<"reloading" | "choice"> {
  state.needsChoice = true;
  let accountRecords = 0;
  try {
    accountRecords = (await httpSyncApi(profile.id).summary()).records;
  } catch {
    /* offline: the choice is still shown; running it will say what went wrong */
  }
  const deviceRecords = guestRecordCount();
  state.choice = { userId: profile.id, email: profile.email, deviceRecords, accountRecords, busy: false, error: "" };
  if (deviceRecords === 0) {
    // nothing on this device to decide about: take the account's data (an empty account stays empty)
    await finishChoice("account");
    return "reloading";
  }
  return "choice";
}

/** Reopens the choice for a signed-in person whose device has not finished it ("Not now" earlier). */
export async function resumeChoice(profile: Pick<Profile, "id" | "email">): Promise<void> {
  writeHint({ userId: profile.id, email: profile.email });
  await openChoice(profile);
}

export function dismissChoice(): void {
  state.choice = null;
}

/** "upload": this device's data goes to the account (a safety snapshot first, Undo afterwards). "account": start with what the account already has. */
export async function finishChoice(kind: "upload" | "account"): Promise<void> {
  const c = state.choice;
  if (!c || c.busy) return;
  c.busy = true;
  c.error = "";
  const id = c.userId;
  try {
    if (kind === "upload") await saveSnapshot("Before uploading this device's data to your account");
    // a fresh start for this account on this device: whatever sync memory or cache is left from before is meaningless now
    clearUserCache(id);
    await idbBaseStore(id).clear();
    const e = makeEngine(id, false); // fills the cache only: the page still runs on the guest data until the reload
    await e.init();
    const report = kind === "upload" ? await e.uploadDeviceData((k) => guestRead(k)) : await e.startWithAccount();
    if (report.rejected.length) state.message = `${report.rejected.length} record${report.rejected.length === 1 ? " was" : "s were"} refused by the server and stay only on this device.`;
    markReady(id);
    state.choice = null;
    state.needsChoice = false;
    reload();
  } catch (e) {
    clearUserCache(id);
    await idbBaseStore(id).clear().catch(() => undefined);
    c.busy = false;
    c.error = describeError(e instanceof SyncApiError ? e.kind : "server");
  }
}

// ---- leaving ----

/** Changes that have not reached the account (0 in guest mode). */
export const pendingChanges = (): number => (engine ? engine.pending() : 0);

async function leaveAccountMode(id: string | null) {
  stopSync();
  clearHint();
  if (id) {
    clearUserCache(id);
    await idbBaseStore(id).clear().catch(() => undefined);
  }
}

/**
 * Signs out. In account mode the account's copy on this device is removed (the account keeps its own); if some changes have not reached the account yet this refuses
 * (returns how many) unless `discard` is true.
 */
export async function signOutEverywhere(opts: { discard?: boolean } = {}): Promise<{ blocked: number } | { blocked: 0 }> {
  const hint = readHint();
  if (isUserCacheActive() && engine && !opts.discard) {
    const n = engine.pending();
    if (n > 0) return { blocked: n };
  }
  // Offline (or the server is down): the sign-out on THIS device still goes ahead. The session on the server ends by itself when it expires.
  await signOutServer().catch(() => undefined);
  await leaveAccountMode(hint?.userId ?? null);
  reload();
  return { blocked: 0 };
}

/**
 * Deletes the account. In account mode a backup file of the data is downloaded FIRST (it is the only copy once the account is gone) and the deletion does not go ahead
 * if that fails. Afterwards the device returns to guest mode with its own guest data exactly as it was.
 */
export async function deleteAccountEverywhere(confirm: string): Promise<void> {
  const hint = readHint();
  if (isUserCacheActive()) await downloadBackupFile(`hisaab-account-backup-${new Date().toISOString().slice(0, 10)}.json`);
  await deleteServerAccount(confirm);
  await leaveAccountMode(hint?.userId ?? null);
  reload();
}

export function useSync() {
  return readonly(state);
}
