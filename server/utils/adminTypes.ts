// The admin panel's view of the data. The admin reads PROJECTION COLUMNS only (amounts in integer minor units, the day key the CLIENT computed, a kind, a category, an account,
// a parent id, a file size) and a few account fields (email, name, role, state). The record content (`data`: notes, names, receipts' file names, the vault) and the
// password hash, tokens and sessions are not reachable through this interface at all: nothing here selects them (tests/adminPrivacy.test.ts scans for that).

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: Date;
  /** the last time this account's sync ran (the cursor's `updatedAt`), or null if it never has */
  lastSyncAt: Date | null;
  records: number;
  bytes: number;
}

/** A live (not deleted) record's projection: all the admin ever reads of it. */
export interface ProjRow {
  userId: string;
  collection: string;
  dayKey: string | null;
  amountMinor: bigint | null;
  kind: string | null;
  categoryId: string | null;
  accountId: string | null;
  parentId: string | null;
  sizeBytes: bigint | null;
}

export interface AuditRecord {
  id: string;
  at: Date;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: unknown;
}

export interface AdminRepo {
  listUsers(q: { search?: string; role?: string; status?: string; skip: number; take: number }): Promise<{ users: AdminUser[]; total: number }>;
  getUser(id: string): Promise<AdminUser | null>;
  /** live records per collection for one user */
  countsByCollection(userId: string): Promise<Record<string, number>>;
  /** projection rows of live records of the given collections, for one user or for everyone */
  rows(q: { userId?: string; collections: string[] }): Promise<ProjRow[]>;
  /** enabled super admins */
  superAdminCount(): Promise<number>;
  emailTaken(email: string, exceptId: string): Promise<boolean>;
  updateUser(id: string, patch: { name?: string; email?: string; role?: string; disabled?: boolean }): Promise<void>;
  revokeSessions(id: string): Promise<void>;
  /** removes the user; the database cascades to everything of theirs */
  deleteUser(id: string): Promise<void>;
  audit(entry: Omit<AuditRecord, "id" | "at">): Promise<void>;
  listAudit(q: { skip: number; take: number }): Promise<{ entries: AuditRecord[]; total: number }>;
  overview(): Promise<{ users: number; superAdmins: number; disabled: number; activeLast7Days: number; records: number; bytes: number }>;
}
