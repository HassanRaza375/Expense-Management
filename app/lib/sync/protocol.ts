// The wire format of sync: what the browser sends and the server answers. Shared types only.
export interface WireRecord {
  collection: string;
  id: string;
  /** null for a deleted record */
  data: unknown | null;
  deleted: boolean;
  revision: number;
  version: number;
}

export type PushResult =
  | { collection: string; id: string; status: "ok"; revision: number; version: number; deleted: boolean }
  | { collection: string; id: string; status: "conflict"; current: WireRecord }
  | { collection: string; id: string; status: "rejected"; reason: string };

export interface PushResponse {
  results: PushResult[];
  cursor: number;
}

export interface PullResponse {
  records: WireRecord[];
  cursor: number;
  more: boolean;
}

export interface SummaryResponse {
  records: number;
  revision: number;
  bytes: number;
  maxBytes: number;
}
