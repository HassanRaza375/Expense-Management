import { runStartup } from "~/lib/startup";
import { isSyncOn } from "~/lib/sync/flag";

// Runs before the first page (or layout) is loaded, see app/lib/startup.ts.
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  const outcome = await runStartup(isSyncOn(useRuntimeConfig().public.syncEnabled));
  if (outcome.blocked) {
    useState<string>("startup-blocked").value = outcome.message;
    // a page of its own (no layout, no composable); nothing else may load, so nothing can read the data
    return to.path === "/startup-blocked" ? undefined : navigateTo("/startup-blocked", { replace: true });
  }
  // the blocked screen is only for a blocked start: anyone typing its address with healthy data goes to the app
  if (to.path === "/startup-blocked") return navigateTo("/dashboard", { replace: true });
});
