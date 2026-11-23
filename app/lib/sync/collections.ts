// The sync collections: one record per thing, flattened so two devices never overwrite each other (docs/NUXT_PLAN.md section 5, D12).
// Shared by the browser and the server. Pure: no Vue, no storage, no network.
//
// A record is `{ collection, id, data }`. `data` is the app's own object exactly as the browser holds it (unknown fields survive), with the parent's id in
// `parentField` for children (a fund's contribution carries `fundId`). The spec names the few fields the SERVER projects into indexed columns for the admin
// panel: the day (a key the CLIENT computed with the app's own rule), the amount (integer minor units), a kind, a category and an account. Nothing else of a
// record is ever read by the admin.

export interface CollectionSpec {
  name: string;
  /** the localStorage key (without `hisaab:`) whose value this collection is part of */
  key: string;
  /** children only: the collection of the parent, and the record field that holds the parent's id */
  parent?: string;
  parentField?: string;
  /** the record field the client turns into a `dayKey` (`YYYY-MM-DD`) */
  dayField?: string;
  /** the record field projected as integer minor units (amount * 100) */
  amountField?: string;
  kindField?: string;
  kindDefault?: string;
  categoryField?: string;
  accountField?: string;
  /** the largest accepted record, in bytes of its JSON */
  maxBytes: number;
}

const KB = 1024;

export const COLLECTIONS: CollectionSpec[] = [
  { name: "settings", key: "settings", maxBytes: 16 * KB },
  { name: "category", key: "categories", maxBytes: 4 * KB },
  { name: "expense", key: "expenses", dayField: "date", amountField: "amount", kindField: "kind", kindDefault: "expense", categoryField: "categoryId", accountField: "accountId", maxBytes: 16 * KB },
  { name: "income", key: "income", dayField: "date", amountField: "amount", kindField: "sourceType", accountField: "accountId", maxBytes: 16 * KB },
  { name: "recurring", key: "recurring", amountField: "amount", categoryField: "categoryId", maxBytes: 8 * KB },
  { name: "billConnection", key: "bills", maxBytes: 8 * KB },
  { name: "bill", key: "bills", parent: "billConnection", parentField: "connectionId", dayField: "dueDate", amountField: "amount", kindField: "status", maxBytes: 16 * KB },
  { name: "meterReading", key: "meterReadings", parent: "billConnection", parentField: "connectionId", dayField: "date", maxBytes: 4 * KB },
  { name: "asset", key: "assets", dayField: "purchaseDate", amountField: "currentValue", maxBytes: 8 * KB },
  { name: "loan", key: "lending", dayField: "date", amountField: "amount", kindField: "direction", maxBytes: 8 * KB },
  { name: "repayment", key: "lending", parent: "loan", parentField: "loanId", dayField: "date", amountField: "amount", accountField: "accountId", maxBytes: 4 * KB },
  { name: "fund", key: "investments", maxBytes: 8 * KB },
  { name: "fundContribution", key: "investments", parent: "fund", parentField: "fundId", dayField: "date", amountField: "amount", maxBytes: 4 * KB },
  { name: "fundWithdrawal", key: "investments", parent: "fund", parentField: "fundId", dayField: "date", amountField: "amount", maxBytes: 4 * KB },
  { name: "fundValue", key: "investments", parent: "fund", parentField: "fundId", dayField: "date", amountField: "value", maxBytes: 4 * KB },
  { name: "account", key: "accounts", dayField: "openingDate", amountField: "openingBalance", kindField: "type", maxBytes: 8 * KB },
  { name: "transfer", key: "accounts", dayField: "date", amountField: "amount", accountField: "fromAccountId", maxBytes: 4 * KB },
  { name: "correction", key: "accounts", dayField: "date", amountField: "amount", accountField: "accountId", maxBytes: 4 * KB },
  { name: "vehicle", key: "vehicles", maxBytes: 8 * KB },
  { name: "vehicleLog", key: "vehicleLogs", parent: "vehicle", parentField: "vehicleId", dayField: "date", amountField: "cost", maxBytes: 8 * KB },
  { name: "fuelLog", key: "fuelLogs", parent: "vehicle", parentField: "vehicleId", dayField: "date", amountField: "cost", maxBytes: 4 * KB },
  { name: "vehicleTag", key: "vehicleTags", maxBytes: 4 * KB },
  { name: "goal", key: "goals", dayField: "startDay", amountField: "targetAmount", maxBytes: 8 * KB },
  { name: "goalSaving", key: "goals", parent: "goal", parentField: "goalId", dayField: "date", amountField: "amount", maxBytes: 4 * KB },
  { name: "vault", key: "vault", maxBytes: 512 * KB },
];

export const COLLECTION_BY_NAME: Record<string, CollectionSpec> = Object.fromEntries(COLLECTIONS.map((c) => [c.name, c]));

export const isCollection = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(COLLECTION_BY_NAME, name);

/** The singletons: one record with a fixed id. */
export const SINGLETON_ID: Record<string, string> = { settings: "settings", vault: "vault" };

/** The data version the sync protocol speaks. A client and a server with different ones refuse each other (the app must be updated). */
export const SYNC_SCHEMA_VERSION = 3;

/** Per-user limits (D39). */
export const LIMITS = {
  maxOpsPerPush: 200,
  maxPushBytes: 1024 * 1024,
  maxPullRecords: 500,
  maxUserBytes: 25 * 1024 * 1024,
  maxIdLength: 100,
} as const;

/** A record id: the app's own ids (uuid or `id-<time>-<random>`) and the fixed ones. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;

export interface SyncRecord {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

export const recordKey = (collection: string, id: string): string => `${collection}/${id}`;
