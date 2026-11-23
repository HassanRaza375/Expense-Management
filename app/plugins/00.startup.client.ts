import { runStartup } from "~/lib/startup";
import { isSyncOn } from "~/lib/sync/flag";

// The data check (migration, snapshot, and the switch to ACCOUNT mode) must finish BEFORE any composable module is evaluated, because composables read their storage the
// moment they are imported (docs/DECISIONS.md D7, app/lib/startup.ts).
//
// Why a plugin and not only the route middleware: Nuxt's own router plugin (`nuxt:router`) awaits `router.isReady()` inside its setup. That first navigation runs WITHOUT the global
// middleware and resolves the route's page component, so the page chunk and every composable it imports are evaluated right there. The middleware only runs later (on
// `app:created`), too late to be the guard. This plugin awaits the startup first: its `order` is below every Nuxt plugin (the router is -20, the lowest built-in is -50).
// The middleware stays: it turns a blocked start into the "Hisaab did not start" screen. tests: e2e/loadOrder.spec.ts records the order in a real browser.
export default defineNuxtPlugin({
  name: "hisaab-startup",
  order: -60,
  async setup() {
    await runStartup(isSyncOn(useRuntimeConfig().public.syncEnabled));
  },
});
