// The server's side of sync: what a push is allowed to write and what a pull returns. Pure logic over the SyncRepo interface, so unit tests run the REAL rules
// against an in-memory fake with no database. Every call is for ONE user, whose id the route took from the session (never from the request).
//
// Rules (D13, D15, D17):
//  - a record is written only if the pusher saw its latest revision (`base`); otherwise the answer is a conflict carrying the current record and nothing is written;
//  - the same push twice is the same result (a replay whose data equals what is stored is `ok`);
//  - a delete is a tombstone (the row stays); a later put with the tombstone's revision brings the record back (Undo);
//  - the server never works out a day: the client's `dayKey` is checked for form and for being a real date, and stored as it is;
//  - the projection columns are filled from the validated record; money is integer minor units;
//  - limits per push and per user, so no account can grow without bound.
import { z } from "zod";
import { COLLECTION_BY_NAME, ID_RE, LIMITS, SINGLETON_ID, SYNC_SCHEMA_VERSION, isCollection, type CollectionSpec } from "../../app/lib/sync/collections";
import { isRealDayKey, toMinorUnits } from "../../app/lib/dayKey";
import { deepEqual } from "../../app/lib/sync/merge";
import type { PullResponse, PushResponse, PushResult, SummaryResponse, WireRecord } from "../../app/lib/sync/protocol";
import { ServiceError } from "./accountService";
import type { Projection, Row, SyncRepo, Tx } from "./syncTypes";

export type { PullResponse, PushResponse, PushResult, SummaryResponse, WireRecord } from "../../app/lib/sync/protocol";

const MAX_SAFE_MINOR = 10n ** 13n; // 100 billion units: beyond any real amount, still inside a 64-bit column

const Op = z
  .object({
    collection: z.string(),
    id: z.string(),
    base: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    put: z.record(z.string(), z.unknown()).optional(),
    delete: z.literal(true).optional(),
    dayKey: z.string().nullable().optional(),
  })
  .strict();

const Body = z.object({ ops: z.array(z.unknown()) }).strict();

type ParsedOp = z.infer<typeof Op>;

/** The fields a collection's spec names, checked for type. Everything else in the record is the app's and passes through untouched. */
function recordSchema(spec: CollectionSpec) {
  const text = z.string().max(200);
  const shape: Record<string, z.ZodType> = {};
  if (spec.parentField) shape[spec.parentField] = z.string().min(1).max(LIMITS.maxIdLength);
  for (const f of [spec.kindField, spec.categoryField, spec.accountField]) if (f) shape[f] = text.nullable().optional();
  if (spec.amountField) shape[spec.amountField] = z.union([z.number().finite(), z.literal(""), z.null()]).optional();
  if (spec.sizeField) shape[spec.sizeField] = z.number().int().min(0).max(2 ** 40).optional();
  if (spec.dayField) shape[spec.dayField] = z.union([z.string().max(64), z.number(), z.null()]).optional();
  return z.looseObject(shape);
}
const schemas = new Map<string, ReturnType<typeof recordSchema>>();
const schemaOf = (spec: CollectionSpec) => schemas.get(spec.name) ?? (schemas.set(spec.name, recordSchema(spec)), schemas.get(spec.name)!);

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, 200) : null);

/** The indexed columns of a validated record. Throws RangeError for an amount that is not a sane number. */
export function projectionOf(spec: CollectionSpec, data: Record<string, unknown>, dayKey: string | null): Projection {
  let amountMinor: bigint | null = null;
  if (spec.amountField) {
    const v = data[spec.amountField];
    if (typeof v === "number") {
      amountMinor = toMinorUnits(v);
      if (amountMinor > MAX_SAFE_MINOR || amountMinor < -MAX_SAFE_MINOR) throw new RangeError("amount out of range");
    }
  }
  const kind = spec.kindField ? (str(data[spec.kindField]) ?? spec.kindDefault ?? null) : null;
  return {
    parentId: spec.parentField ? str(data[spec.parentField]) : null,
    dayKey,
    amountMinor,
    kind,
    categoryId: spec.categoryField ? str(data[spec.categoryField]) : null,
    accountId: spec.accountField ? str(data[spec.accountField]) : null,
    sizeBytes: spec.sizeField && typeof data[spec.sizeField] === "number" ? BigInt(data[spec.sizeField] as number) : null, // a file's size (already checked to be an integer by the record schema); never its name or content
  };
}

const wire = (r: Row): WireRecord => ({ collection: r.collection, id: r.id, data: r.deleted ? null : r.data, deleted: r.deleted, revision: Number(r.revision), version: r.version });

/** The request-level checks: the client's data version must be the server's (the app must be updated otherwise). */
export function checkSchema(header: unknown): void {
  if (String(header ?? "") !== String(SYNC_SCHEMA_VERSION)) throw new ServiceError(409, "schema_mismatch");
}

type Checked = { ok: true; op: ParsedOp; bytes: number; projection: Projection } | { ok: false; reason: string };

/** Everything about one operation that can be checked without reading the database. */
function check(raw: unknown): { collection: string; id: string } & Checked {
  const parsed = Op.safeParse(raw);
  const id0 = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : "";
  const col0 = typeof (raw as { collection?: unknown })?.collection === "string" ? (raw as { collection: string }).collection : "";
  const bad = (reason: string) => ({ collection: col0, id: id0, ok: false as const, reason });
  if (!parsed.success) return bad("invalid_operation");
  const op = parsed.data;
  if (!isCollection(op.collection)) return bad("unknown_collection");
  if (!ID_RE.test(op.id)) return bad("invalid_id");
  if ((op.put === undefined) === (op.delete === undefined)) return bad("invalid_operation");
  if (op.dayKey != null && !isRealDayKey(op.dayKey)) return bad("invalid_day");
  const spec = COLLECTION_BY_NAME[op.collection]!;
  const singleton = SINGLETON_ID[op.collection];
  if (singleton !== undefined && op.id !== singleton) return bad("invalid_id");
  if (op.delete) return { collection: op.collection, id: op.id, ok: true, op, bytes: 0, projection: {} };
  const data = op.put!;
  if (singleton === undefined && data.id !== op.id) return bad("id_mismatch");
  const bytes = Buffer.byteLength(JSON.stringify(data));
  if (bytes > spec.maxBytes) return bad("record_too_large");
  if (!schemaOf(spec).safeParse(data).success) return bad("invalid_record");
  try {
    return { collection: op.collection, id: op.id, ok: true, op, bytes, projection: projectionOf(spec, data, op.dayKey ?? null) };
  } catch {
    return bad("invalid_amount");
  }
}

/** Applies a push for one user, atomically. Whole-request problems throw ServiceError; a bad or stale operation is answered for that operation only. */
export async function applyPush(repo: SyncRepo, userId: string, body: unknown): Promise<PushResponse> {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new ServiceError(400, "invalid_request");
  if (parsed.data.ops.length > LIMITS.maxOpsPerPush) throw new ServiceError(413, "too_many_operations");

  return repo.transaction(userId, async (tx: Tx) => {
    const cursor = await tx.lockCursor(userId);
    let revision = cursor.revision;
    let total = cursor.bytes;
    const results: PushResult[] = [];

    for (const raw of parsed.data.ops) {
      const c = check(raw);
      if (!c.ok) {
        results.push({ collection: c.collection, id: c.id, status: "rejected", reason: c.reason });
        continue;
      }
      const { op } = c;
      const existing = await tx.record(userId, op.collection, op.id);
      const seen = BigInt(op.base);

      if (op.delete) {
        if (!existing || existing.deleted) {
          // nothing to delete, or already deleted: the same answer a replay would get
          results.push({ collection: op.collection, id: op.id, status: "ok", revision: existing ? Number(existing.revision) : Number(revision), version: existing?.version ?? 0, deleted: true });
          continue;
        }
        if (existing.revision !== seen) {
          results.push({ collection: op.collection, id: op.id, status: "conflict", current: wire(existing) });
          continue;
        }
        revision += 1n;
        total -= existing.bytes;
        await tx.put(userId, { collection: op.collection, id: op.id, data: null, version: existing.version + 1, revision, deleted: true, bytes: 0, projection: {} });
        results.push({ collection: op.collection, id: op.id, status: "ok", revision: Number(revision), version: existing.version + 1, deleted: true });
        continue;
      }

      if (existing) {
        if (existing.revision !== seen) {
          if (!existing.deleted && deepEqual(existing.data, op.put)) {
            // a replay of a push that already succeeded (its answer was lost): the same result, nothing written
            results.push({ collection: op.collection, id: op.id, status: "ok", revision: Number(existing.revision), version: existing.version, deleted: false });
          } else {
            results.push({ collection: op.collection, id: op.id, status: "conflict", current: wire(existing) });
          }
          continue;
        }
        if (!existing.deleted && deepEqual(existing.data, op.put)) {
          results.push({ collection: op.collection, id: op.id, status: "ok", revision: Number(existing.revision), version: existing.version, deleted: false });
          continue;
        }
      }
      const next = total - (existing?.bytes ?? 0) + c.bytes;
      if (next > LIMITS.maxUserBytes) {
        results.push({ collection: op.collection, id: op.id, status: "rejected", reason: "quota_exceeded" });
        continue;
      }
      revision += 1n;
      total = next;
      const version = (existing?.version ?? 0) + 1;
      await tx.put(userId, { collection: op.collection, id: op.id, data: op.put, version, revision, deleted: false, bytes: c.bytes, projection: c.projection });
      results.push({ collection: op.collection, id: op.id, status: "ok", revision: Number(revision), version, deleted: false });
    }

    if (revision !== cursor.revision || total !== cursor.bytes) await tx.setCursor(userId, revision, total);
    return { results, cursor: Number(revision) };
  });
}

/** The records changed after `since`, oldest first, in pages. */
export async function pullSince(repo: SyncRepo, userId: string, since: unknown): Promise<PullResponse> {
  const n = typeof since === "number" ? since : NaN;
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) throw new ServiceError(400, "invalid_request");
  const rows = await repo.since(userId, BigInt(n), LIMITS.maxPullRecords);
  return { records: rows.map(wire), cursor: rows.length ? Number(rows[rows.length - 1]!.revision) : n, more: rows.length === LIMITS.maxPullRecords };
}

/** What the account holds (for the first-sign-in choice and the Settings card). Counts only: no record content. */
export async function summaryOf(repo: SyncRepo, userId: string): Promise<SummaryResponse> {
  const u = await repo.usage(userId);
  return { records: u.records, revision: Number(u.revision), bytes: u.bytes, maxBytes: LIMITS.maxUserBytes };
}
