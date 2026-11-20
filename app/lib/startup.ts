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

export interface StartupOutcome {
  blocked: boolean;
  message: string;
  status?: string;
}

let started: Promise<StartupOutcome> | null = null;

export function runStartup(): Promise<StartupOutcome> {
  started ??= (prepareData() as Promise<StartupOutcome>).catch((err: unknown) => ({
    blocked: true,
    message: `Hisaab could not check your saved data, so it did not start. (${err instanceof Error ? err.message : String(err)}) Nothing was changed.`,
  }));
  return started;
}
