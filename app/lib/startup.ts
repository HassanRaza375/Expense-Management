// The data check that must finish BEFORE any page, layout or composable module is loaded (docs/DECISIONS.md D7).
//
// Composables read localStorage when their module is first imported, so nothing that imports them may load before this has run. The old Vite app
// guaranteed that with `await prepareData()` before a dynamic `import('./App.vue')`; here the same guarantee comes from three rules:
//   1. `app/app.vue` imports no composable (it only shows the blocked screen or the layout);
//   2. the global route middleware `app/middleware/startup.global.ts` awaits `runStartup()` before the first navigation resolves, and pages and
//      layouts are lazy chunks that only load after that;
//   3. `runStartup()` is a single shared promise, so everything that needs the outcome gets the same one.
// If the stored data is from a newer version of Hisaab, or an update fails, the outcome is `blocked` and the app does not start; nothing more is written.
import { prepareData } from "../utils/startup.js";
import { activateIfSignedIn, type Hint } from "./sync/mode";

export interface StartupOutcome {
  blocked: boolean;
  message: string;
  status?: string;
  /** who this device is in ACCOUNT mode for (the synced keys live in their cache), or null in guest mode */
  account?: Hint | null;
}

let started: Promise<StartupOutcome> | null = null;

/**
 * `accountsOn` is the public sync flag. After the data check (which always works on the guest data, whatever the mode), a device that is signed in and finished its
 * first-sign-in choice is switched to ACCOUNT mode: the storage wrapper is pointed at that user's cache. Still before any composable loads.
 */
export function runStartup(accountsOn = false): Promise<StartupOutcome> {
  started ??= (async () => {
    const outcome = (await prepareData()) as StartupOutcome;
    if (outcome.blocked) return outcome;
    try {
      return { ...outcome, account: activateIfSignedIn(accountsOn) };
    } catch {
      return { ...outcome, account: null }; // never let the account switch stop the app: guest mode is always available
    }
  })().catch((err: unknown) => ({
    blocked: true,
    message: `Hisaab could not check your saved data, so it did not start. (${err instanceof Error ? err.message : String(err)}) Nothing was changed.`,
  }));
  return started;
}
