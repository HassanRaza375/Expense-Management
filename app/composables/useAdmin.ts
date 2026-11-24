// The admin pages' calls. To anyone who is not a signed-in super admin every admin route answers 404, so a 404 (or accounts being off) sends the page to the dashboard exactly
// as an unknown address does: the admin area does not reveal that it exists.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, apiFetch, friendly, jsonInit } from "../lib/account/api";
import { accountsEnabled } from "./useAccount";

export class NotAdmin extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === "not_found") throw new NotAdmin();
    throw e;
  }
}

export const adminGet = <T>(path: string): Promise<T> => call<T>(path, { method: "GET" });
export const adminPatch = <T>(path: string, body: unknown): Promise<T> => call<T>(path, jsonInit("PATCH", body));
export const adminDelete = <T>(path: string, body: unknown): Promise<T> => call<T>(path, jsonInit("DELETE", body));
export const adminPost = <T>(path: string, body: unknown = {}): Promise<T> => call<T>(path, jsonInit("POST", body));

/** Money in minor units (amount x 100) as a plain number with two decimals. */
export const minor = (n: number): string => (n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "never");

/** Loads a page's data once mounted. Not an admin (or accounts off): straight to the dashboard, as for any unknown address. */
export function useAdminLoad<T>(fetcher: () => Promise<T>) {
  const router = useRouter();
  const data = ref<T | null>(null);
  const error = ref("");
  const loading = ref(true);
  async function load() {
    loading.value = true;
    error.value = "";
    try {
      data.value = (await fetcher()) as never;
    } catch (e) {
      if (e instanceof NotAdmin) await router.replace("/dashboard");
      else error.value = friendly(e);
    } finally {
      loading.value = false;
    }
  }
  onMounted(() => {
    if (!accountsEnabled()) {
      router.replace("/dashboard");
      return;
    }
    load();
  });
  return { data, error, loading, load };
}
