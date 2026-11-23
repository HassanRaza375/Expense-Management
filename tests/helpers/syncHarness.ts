// Simulated devices for the sync tests: each has its own cache (the user's stored values) and base store, all talking to ONE in-memory account through the REAL
// server rules (applyPush / pullSince over the fake repository). A device can go offline, and an answer can be lost after the server applied the push.
import { SyncApiError, SyncEngine, type BaseState, type BaseStore, type LocalStore, type SyncApi } from "../../app/lib/sync/engine";
import type { BaseEntry, PushOp } from "../../app/lib/sync/plan";
import type { PullResponse, PushResponse } from "../../app/lib/sync/protocol";
import { applyPush, pullSince } from "../../server/utils/syncService";
import { fakeSyncRepo } from "../fakes/syncRepo";
import { clone, type Storage } from "./syncData";

export type Account = { repo: ReturnType<typeof fakeSyncRepo>; userId: string };
export const newAccount = (userId = "user-1"): Account => ({ repo: fakeSyncRepo(), userId });

export function memoryBases(): BaseStore & { state: BaseState | null } {
  const self: BaseStore & { state: BaseState | null } = {
    state: null,
    async load() {
      return self.state ? { ...self.state, base: new Map(self.state.base) } : null;
    },
    async save(p) {
      const s = (self.state ??= { base: new Map<string, BaseEntry>(), cursor: 0 });
      for (const [k, v] of p.put ?? []) s.base.set(k, clone(v));
      for (const k of p.del ?? []) s.base.delete(k);
      if (p.cursor !== undefined) s.cursor = p.cursor;
      if (p.lastUpload !== undefined) s.lastUpload = p.lastUpload ?? [];
      if (p.lastSyncAt !== undefined) s.lastSyncAt = p.lastSyncAt;
    },
    async clear() {
      self.state = null;
    },
  };
  return self;
}

export interface Device {
  name: string;
  cache: Map<string, unknown>;
  bases: ReturnType<typeof memoryBases>;
  engine: SyncEngine;
  online: boolean;
  /** the next push is applied by the server, then the answer is lost */
  loseNextPushAnswer: boolean;
  calls: { push: PushOp[][]; pull: number[] };
  /** runs once at the start of the next pull (to model an edit made while the network was busy) */
  duringPull: (() => void) | null;
  /** the keys the engine wrote, in order */
  writes: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(key: string): any;
  set(key: string, value: unknown): void;
  sync(opts?: { allowMassDelete?: boolean }): ReturnType<SyncEngine["syncOnce"]>;
}

export async function device(name: string, account: Account, initial: Storage = {}): Promise<Device> {
  const cache = new Map<string, unknown>(Object.entries(clone(initial)));
  const bases = memoryBases();
  const writes: string[] = [];
  const store: LocalStore = {
    read: (key) => (cache.has(key) ? clone(cache.get(key)) : undefined),
    write(key, value) {
      writes.push(key);
      if (value === undefined) cache.delete(key);
      else cache.set(key, clone(value));
    },
  };
  const d: Device = {
    name,
    cache,
    bases,
    engine: null as unknown as SyncEngine,
    online: true,
    loseNextPushAnswer: false,
    calls: { push: [], pull: [] },
    duringPull: null,
    writes,
    get: (key) => (cache.has(key) ? clone(cache.get(key)) : undefined),
    set: (key, value) => void cache.set(key, clone(value)),
    sync: (opts) => d.engine.syncOnce(opts),
  };
  const api: SyncApi = {
    async push(ops): Promise<PushResponse> {
      if (!d.online) throw new SyncApiError("offline");
      d.calls.push.push(clone(ops));
      const res = await applyPush(account.repo, account.userId, { ops });
      if (d.loseNextPushAnswer) {
        d.loseNextPushAnswer = false;
        throw new SyncApiError("offline");
      }
      return res;
    },
    async pull(since): Promise<PullResponse> {
      if (!d.online) throw new SyncApiError("offline");
      d.calls.pull.push(since);
      const hook = d.duringPull;
      d.duringPull = null;
      hook?.();
      return pullSince(account.repo, account.userId, since);
    },
  };
  d.engine = new SyncEngine({ api, store, bases, now: () => 1_700_000_000_000 });
  await d.engine.init();
  return d;
}
