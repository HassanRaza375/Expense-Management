// The repository interface of the sync store. The sync logic (Phase 5) is written against this, never against Prisma, so unit tests run the REAL rules against an
// in-memory fake (tests/fakes/syncRepo.ts) with no database. Every call is for ONE user, whose id the route took from the session (never from the request body).

/** What the server fills in from a validated record: the only columns the admin panel ever reads. */
export interface Projection {
  parentId?: string | null;
  dayKey?: string | null;
  amountMinor?: bigint | null;
  kind?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  sizeBytes?: bigint | null;
}

export interface Row {
  collection: string;
  id: string;
  /** null when deleted (a tombstone) */
  data: unknown | null;
  version: number;
  revision: bigint;
  deleted: boolean;
  bytes: number;
  projection: Projection;
}

export interface Tx {
  /** the user's revision counter and bytes, with the row locked for this transaction (two devices' pushes are ordered by it) */
  lockCursor(userId: string): Promise<{ revision: bigint; bytes: number }>;
  record(userId: string, collection: string, id: string): Promise<Row | null>;
  put(userId: string, row: Row): Promise<void>;
  setCursor(userId: string, revision: bigint, bytes: number): Promise<void>;
}

export interface SyncRepo {
  /** runs `fn` atomically: if it throws, nothing it wrote is kept */
  transaction<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** records with a revision above `since`, oldest first, at most `limit` */
  since(userId: string, since: bigint, limit: number): Promise<Row[]>;
  /** deletes every row of the user (account deletion); the cursor goes with them */
  removeAll(userId: string): Promise<{ removed: number }>;
  /** one record of the user (null when there is none) */
  get(userId: string, collection: string, id: string): Promise<Row | null>;
  /** the ids of the user's live (not deleted) records of one collection, optionally only those under one parent */
  liveIds(userId: string, collection: string, parentId?: string): Promise<string[]>;
  usage(userId: string): Promise<{ revision: bigint; bytes: number; records: number }>;
}
