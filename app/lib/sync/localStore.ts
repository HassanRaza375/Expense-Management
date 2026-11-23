// The engine's view of this device: the user's cache in localStorage (`hisaab:u:<userId>:<key>`), read and written synchronously.
// `live: true` also puts a written value into the page's live state (the composables), so a change from the account shows without a reload;
// `live: false` is for the first sign-in, when the page still runs on the guest data and only the cache is being filled.
import { nextTick } from "vue";
import { applyToLive } from "../../utils/storage.js";
import type { LocalStore } from "./engine";
import { userKey } from "./mode";

export function userLocalStore(userId: string, opts: { live: boolean; storage?: Storage } = { live: true }): LocalStore {
  const storage = opts.storage ?? localStorage;
  return {
    read(key) {
      try {
        const raw = storage.getItem(userKey(userId, key));
        return raw === null ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    write(key, value) {
      if (value === undefined) {
        storage.removeItem(userKey(userId, key));
        return;
      }
      storage.setItem(userKey(userId, key), JSON.stringify(value));
      if (opts.live) applyToLive(key, JSON.parse(JSON.stringify(value)));
    },
    // the composables write their state back in a watcher that runs on the next tick: wait for it, so what the engine reads is what the person last did
    settle: () => nextTick().then(() => nextTick()),
  };
}
