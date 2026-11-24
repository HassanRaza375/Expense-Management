// The sync engine. State-based, not an op log: it compares this device's records with the BASE (the records as of the last successful sync), pushes the difference,
// pulls what changed on the account, merges field by field and writes the result back. Nothing is ever dropped silently:
//   - a crash at any point is safe: pushes are idempotent and the next run recomputes the difference;
//   - an edit beats a delete, in both directions (a record is only removed when the other side did not touch it);
//   - the remote changes are applied in ONE synchronous block that reads this device's records fresh, so an edit made while the network was busy is never overwritten;
//   - a push that would delete most of the account at once is HELD until the person confirms (a blank or stale device must not empty the account);
//   - a device-only part of a record (receipts, bill files, the theme) is never sent and never overwritten by a pull.
//
// Pure of Vue, storage and network: everything it touches comes in through `deps`, so tests run two devices against the real server rules in memory.
import { ADAPTERS, ADAPTER_BY_KEY, splitAll, type RecordMap } from "./adapters";
import { COLLECTIONS, COLLECTION_BY_NAME, LIMITS, recordKey } from "./collections";
import { clone, deepEqual, mergeData, type Data } from "./merge";
import { planPush, type BaseEntry, type PushOp } from "./plan";
import type { PullResponse, PushResponse, WireRecord } from "./protocol";

export type SyncErrorKind = "offline" | "unauthenticated" | "disabled" | "schema" | "account" | "rate" | "server";

export class SyncApiError extends Error {
  constructor(
    public kind: SyncErrorKind,
    public status = 0,
  ) {
    super(kind);
  }
}

export interface SyncApi {
  push(ops: PushOp[]): Promise<PushResponse>;
  pull(since: number): Promise<PullResponse>;
}

/** This device's records of the signed-in account, as the app stores them. Reads are synchronous. */
export interface LocalStore {
  read(key: string): unknown;
  /** stores the value AND updates the live state of the page; `undefined` removes the key */
  write(key: string, value: unknown): void;
  /** resolves once pending writes of the live state have reached the store (a microtask flush) */
  settle?(): Promise<void>;
}

export interface BaseState {
  base: Map<string, BaseEntry>;
  cursor: number;
  /** the records the last "upload this device's data" created, with the revision each had when the upload finished (for Undo) */
  lastUpload?: Array<[key: string, revision: number]>;
  lastSyncAt?: number | null;
}

export interface BaseStore {
  load(): Promise<BaseState | null>;
  save(patch: { put?: Array<[string, BaseEntry]>; del?: string[]; cursor?: number; lastUpload?: Array<[string, number]> | null; lastSyncAt?: number }): Promise<void>;
  clear(): Promise<void>;
}

export interface SyncDeps {
  api: SyncApi;
  store: LocalStore;
  bases: BaseStore;
  now?: () => number;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  /** records both sides had changed, merged field by field */
  merged: number;
  /** changes still waiting to be sent after this run */
  pending: number;
  /** a push that would delete most of the account, held for confirmation */
  held: { deletes: number; of: number } | null;
  /** records the server refused (kept on this device, tried again next time) */
  rejected: Array<{ key: string; reason: string }>;
  /** true when the run stopped before everything settled (the next run continues) */
  incomplete: boolean;
}

/** a hold needs at least this many deletes AND at least this share of the account's records */
export const MASS_DELETE_MIN = 10;
export const MASS_DELETE_SHARE = 0.5;
const MAX_ROUNDS = 5;
const MAX_BATCH_BYTES = 800 * 1024;

export const EMPTY_VALUE: Record<string, unknown> = { bills: { connections: [], bills: [] }, accounts: { accounts: [], transfers: [], adjustments: [] } };

const childSpecs = (collection: string) => COLLECTIONS.filter((c) => c.parent === collection && c.parentField);

export class SyncEngine {
  private base = new Map<string, BaseEntry>();
  private cursor = 0;
  private lastUpload: Array<[string, number]> = [];
  private lastSyncAt: number | null = null;
  private fresh = true;
  private dirtyPut = new Map<string, BaseEntry>();
  private dirtyDel = new Set<string>();

  constructor(private deps: SyncDeps) {}

  /** Loads what the last run left. `fresh` is true when there was nothing (never synced here, or the base was lost). */
  async init(): Promise<{ fresh: boolean }> {
    const s = await this.deps.bases.load();
    this.base = new Map(s?.base ?? []);
    this.cursor = s?.cursor ?? 0;
    this.lastUpload = s?.lastUpload ?? [];
    this.lastSyncAt = s?.lastSyncAt ?? null;
    this.dirtyPut.clear();
    this.dirtyDel.clear();
    this.fresh = !s;
    return { fresh: this.fresh };
  }

  get lastSync(): number | null {
    return this.lastSyncAt;
  }
  /** the keys of the records the last upload created (for Undo) */
  get uploaded(): string[] {
    return this.lastUpload.map(([k]) => k);
  }

  private readLocal(): RecordMap {
    return splitAll((k) => this.deps.store.read(k));
  }

  /** True when the account has this record (it has been synced here, and is not a tombstone). */
  isSynced(collection: string, id: string): boolean {
    const b = this.base.get(recordKey(collection, id));
    return Boolean(b && !b.deleted);
  }

  /** Changes waiting to be sent. */
  pending(): number {
    return planPush(this.readLocal(), this.base).length;
  }

  private setBase(key: string, e: BaseEntry) {
    this.base.set(key, e);
    this.dirtyPut.set(key, e);
    this.dirtyDel.delete(key);
  }
  private dropBase(key: string) {
    this.base.delete(key);
    this.dirtyPut.delete(key);
    this.dirtyDel.add(key);
  }
  private async persist(extra: { cursor?: number; lastUpload?: Array<[string, number]> | null; lastSyncAt?: number } = {}) {
    const patch = { put: [...this.dirtyPut], del: [...this.dirtyDel], ...extra };
    this.dirtyPut.clear();
    this.dirtyDel.clear();
    await this.deps.bases.save(patch);
    this.fresh = false;
  }

  /** One full run: push, pull, merge, repeat until nothing is left to do (or a safety limit). Throws SyncApiError; whatever was done before it stays done. */
  async syncOnce(opts: { allowMassDelete?: boolean } = {}): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, merged: 0, pending: 0, held: null, rejected: [], incomplete: false };
    const blocked = new Set<string>();
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await this.deps.store.settle?.();
      const ops = planPush(this.readLocal(), this.base).filter((o) => !blocked.has(recordKey(o.collection, o.id)));

      const deletes = ops.filter((o) => o.delete).length;
      const live = [...this.base.values()].filter((b) => !b.deleted).length;
      if (!opts.allowMassDelete && deletes >= MASS_DELETE_MIN && deletes >= live * MASS_DELETE_SHARE) {
        report.held = { deletes, of: live };
        report.pending = ops.length;
        return report;
      }

      const outcome = await this.pushAll(ops, blocked, report);
      const remote = await this.pullAll();
      report.pulled += remote.length;
      const merged = this.apply([...outcome.conflicts, ...remote]);
      report.merged += merged;
      await this.persist({ cursor: this.cursor, lastSyncAt: (this.deps.now ?? Date.now)() });
      this.lastSyncAt = (this.deps.now ?? Date.now)();

      if (ops.length === 0 && remote.length === 0) break; // settled
      if (round === MAX_ROUNDS) report.incomplete = true;
    }
    report.pending = this.pending();
    return report;
  }

  private async pushAll(ops: PushOp[], blocked: Set<string>, report: SyncReport): Promise<{ conflicts: WireRecord[] }> {
    const conflicts: WireRecord[] = [];
    let i = 0;
    while (i < ops.length) {
      const batch: PushOp[] = [];
      let bytes = 0;
      while (i < ops.length && batch.length < LIMITS.maxOpsPerPush) {
        const size = JSON.stringify(ops[i]).length;
        if (batch.length && bytes + size > MAX_BATCH_BYTES) break;
        bytes += size;
        batch.push(ops[i++]!);
      }
      const res = await this.deps.api.push(batch);
      batch.forEach((op, n) => {
        const r = res.results[n];
        const key = recordKey(op.collection, op.id);
        if (!r) return;
        if (r.status === "ok") {
          report.pushed++;
          if (op.delete) this.setBase(key, { revision: r.revision, data: {}, deleted: true });
          else this.setBase(key, { revision: r.revision, data: clone(op.put as Data) });
        } else if (r.status === "conflict") {
          conflicts.push(r.current);
        } else {
          blocked.add(key);
          report.rejected.push({ key, reason: r.reason });
        }
      });
      await this.persist();
    }
    return { conflicts };
  }

  private async pullAll(): Promise<WireRecord[]> {
    const out: WireRecord[] = [];
    for (;;) {
      const page = await this.deps.api.pull(this.cursor);
      out.push(...page.records);
      this.cursor = Math.max(this.cursor, page.cursor);
      if (!page.more) return out;
    }
  }

  /**
   * Merges remote records into this device. ONE synchronous block: it reads this device's records fresh, decides per record, and writes every affected key once.
   * Returns how many records both sides had changed.
   */
  private apply(remote: WireRecord[]): number {
    if (!remote.length) return 0;
    const latest = new Map<string, WireRecord>();
    for (const r of remote) {
      const k = recordKey(r.collection, r.id);
      if (!latest.has(k) || latest.get(k)!.revision <= r.revision) latest.set(k, r);
    }
    const local = this.readLocal();
    const touched = new Set<string>();
    let merged = 0;

    const hasLiveChildren = (collection: string, id: string) => childSpecs(collection).some((c) => [...(local.get(c.name)?.values() ?? [])].some((d) => d[c.parentField!] === id));

    for (const r of [...latest.values()].sort((a, b) => a.revision - b.revision)) {
      const spec = COLLECTION_BY_NAME[r.collection];
      if (!spec) continue; // a collection this version does not know: ignored, never an error
      const key = recordKey(r.collection, r.id);
      const records = local.get(r.collection) ?? local.set(r.collection, new Map()).get(r.collection)!;
      const l = records.get(r.id);
      const b = this.base.get(key);
      const bData = b && !b.deleted ? b.data : null;

      if (r.deleted || r.data === null || typeof r.data !== "object") {
        if (!l) {
          this.setBase(key, { revision: r.revision, data: {}, deleted: true });
        } else if (bData && deepEqual(l, bData) && !hasLiveChildren(r.collection, r.id)) {
          records.delete(r.id); // deleted on the account, untouched here: it goes
          touched.add(spec.key);
          this.setBase(key, { revision: r.revision, data: {}, deleted: true });
        } else {
          // changed here (or has records of its own here): the edit beats the delete. It is sent again over the tombstone.
          this.setBase(key, { revision: r.revision, data: {}, deleted: true });
        }
        continue;
      }

      const rData = r.data as Data;
      if (!l) {
        records.set(r.id, clone(rData)); // new here (or deleted here and changed there: the edit beats the delete)
        touched.add(spec.key);
        this.setBase(key, { revision: r.revision, data: clone(rData) });
      } else if (deepEqual(l, rData)) {
        this.setBase(key, { revision: r.revision, data: clone(rData) }); // already the same
      } else if (bData && deepEqual(l, bData)) {
        records.set(r.id, clone(rData)); // unchanged here: take the account's version
        touched.add(spec.key);
        this.setBase(key, { revision: r.revision, data: clone(rData) });
      } else {
        // both sides changed it (or this device has no base for it): field by field. The base becomes the account's version, so the merged record is sent next.
        const m = mergeData(bData, l, rData);
        if (bData) merged++;
        if (!deepEqual(m.data, l)) {
          records.set(r.id, m.data);
          touched.add(spec.key);
        }
        this.setBase(key, { revision: r.revision, data: clone(rData) });
      }
    }

    for (const key of touched) {
      const adapter = ADAPTER_BY_KEY[key]!;
      const current = this.deps.store.read(key);
      const value = adapter.join(local, current);
      if (!deepEqual(value, current)) this.deps.store.write(key, value);
    }
    return merged;
  }

  // ---- the first sign-in ----

  /**
   * "Upload this device's data to my account": copies the guest data into this account's cache, then syncs. The records this created are remembered for Undo.
   * The caller has already taken the safety snapshot. `guest` reads the device's own (guest) values.
   */
  async uploadDeviceData(guest: (key: string) => unknown): Promise<SyncReport & { uploaded: number }> {
    for (const a of ADAPTERS) {
      const v = guest(a.key);
      if (v !== undefined && v !== null) this.deps.store.write(a.key, clone(v));
    }
    await this.deps.store.settle?.();
    const created = planPush(this.readLocal(), this.base)
      .filter((o) => o.put && o.base === 0)
      .map((o) => recordKey(o.collection, o.id));
    const report = await this.syncOnce({ allowMassDelete: true });
    // remembered with the revision each had when the upload finished: a record edited after that is not the upload's any more
    this.lastUpload = created.filter((k) => this.base.get(k) && !this.base.get(k)!.deleted).map((k) => [k, this.base.get(k)!.revision]);
    await this.persist({ lastUpload: this.lastUpload });
    return { ...report, uploaded: this.lastUpload.length };
  }

  /** "Start with my account's data": an empty cache, then everything the account holds. */
  async startWithAccount(): Promise<SyncReport> {
    return this.syncOnce();
  }

  /** Undo of an upload: removes the records the upload created, except any changed since, and sends the deletes. */
  async undoUpload(): Promise<SyncReport & { removed: number }> {
    const local = this.readLocal();
    const touched = new Set<string>();
    let removed = 0;
    for (const [key, revision] of this.lastUpload) {
      const i = key.indexOf("/");
      const collection = key.slice(0, i);
      const id = key.slice(i + 1);
      const records = local.get(collection);
      const l = records?.get(id);
      const b = this.base.get(key);
      if (!l || !records || !b || b.deleted || b.revision !== revision || !deepEqual(l, b.data)) continue; // gone already, or changed since the upload: left alone
      records.delete(id);
      touched.add(COLLECTION_BY_NAME[collection]!.key);
      removed++;
    }
    for (const key of touched) {
      const adapter = ADAPTER_BY_KEY[key]!;
      this.deps.store.write(key, adapter.join(local, this.deps.store.read(key)));
    }
    this.lastUpload = [];
    await this.persist({ lastUpload: null });
    const report = await this.syncOnce({ allowMassDelete: true });
    return { ...report, removed };
  }

  /** "Restore from my account": forgets this device's records and the base, so the next run brings the account's data back. The caller reloads the page. */
  async restoreFromAccount(): Promise<void> {
    for (const a of ADAPTERS) this.deps.store.write(a.key, undefined);
    this.base = new Map();
    this.cursor = 0;
    this.lastUpload = [];
    this.dirtyPut.clear();
    this.dirtyDel.clear();
    this.fresh = true;
    await this.deps.bases.clear();
  }
}
