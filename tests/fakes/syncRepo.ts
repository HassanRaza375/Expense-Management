// An in-memory SyncRepo for unit tests: the same rules as the Prisma implementation (per-user rows, a per-user cursor, atomic transactions) with no database.
// A transaction works on a copy and keeps it only if the callback finishes; "two devices at once" is modelled by queueing transactions one after another (the
// real store serialises them with `SELECT ... FOR UPDATE` on the cursor row).
import type { Row, SyncRepo, Tx } from "../../server/utils/syncTypes";

interface State {
  rows: Map<string, Row>;
  cursors: Map<string, { revision: bigint; bytes: number }>;
}

const key = (userId: string, collection: string, id: string) => `${userId}\u0000${collection}\u0000${id}`;
const clone = (s: State): State => ({ rows: new Map([...s.rows].map(([k, v]) => [k, { ...v, projection: { ...v.projection } }])), cursors: new Map([...s.cursors].map(([k, v]) => [k, { ...v }])) });

export function fakeSyncRepo(): SyncRepo & { state: State; calls: string[] } {
  let state: State = { rows: new Map(), cursors: new Map() };
  const calls: string[] = [];
  let queue: Promise<void> = Promise.resolve();
  const txFor = (s: State): Tx => ({
    async lockCursor(userId) {
      if (!s.cursors.has(userId)) s.cursors.set(userId, { revision: 0n, bytes: 0 });
      return { ...s.cursors.get(userId)! };
    },
    async record(userId, collection, id) {
      const r = s.rows.get(key(userId, collection, id));
      return r ? { ...r, projection: { ...r.projection } } : null;
    },
    async put(userId, row) {
      s.rows.set(key(userId, row.collection, row.id), { ...row, projection: { ...row.projection } });
    },
    async setCursor(userId, revision, bytes) {
      s.cursors.set(userId, { revision, bytes });
    },
  });
  const repo: SyncRepo = {
    async transaction(userId, fn) {
      calls.push(`transaction:${userId}`);
      // one at a time, like the real store (`SELECT ... FOR UPDATE` on the cursor row): a transaction that starts while another is running waits for it
      const run = queue.then(async () => {
        const work = clone(state);
        const result = await fn(txFor(work));
        state = work;
        return result;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
    async since(userId, since, limit) {
      calls.push(`since:${userId}`);
      return [...state.rows]
        .filter(([k, r]) => k.startsWith(`${userId}\u0000`) && r.revision > since)
        .map(([, r]) => r)
        .sort((a, b) => (a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0))
        .slice(0, limit);
    },
    async removeAll(userId) {
      calls.push(`removeAll:${userId}`);
      let removed = 0;
      for (const k of [...state.rows.keys()]) {
        if (k.startsWith(`${userId}\u0000`)) {
          state.rows.delete(k);
          removed++;
        }
      }
      state.cursors.delete(userId);
      return { removed };
    },
    async usage(userId) {
      const c = state.cursors.get(userId);
      const records = [...state.rows].filter(([k, r]) => k.startsWith(`${userId}\u0000`) && !r.deleted).length;
      return { revision: c?.revision ?? 0n, bytes: c?.bytes ?? 0, records };
    },
  };
  return Object.defineProperties(repo as SyncRepo & { state: State; calls: string[] }, {
    state: { get: () => state },
    calls: { value: calls },
  });
}
