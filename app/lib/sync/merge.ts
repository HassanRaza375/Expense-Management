// Three-way, field-level merge of one record (D13). Pure. Client clocks are never compared: the only inputs are the three versions.
//   base   = the record as of the last successful sync of this device (null when there is none)
//   local  = the record on this device now
//   remote = the record on the server now
// A field changed on one side only takes that side's value. A field changed to different values on both sides is won by the LOCAL value (the device that syncs later
// wins; the other device then pulls it, so both converge). Fields no side mentions stay as they are (unknown fields survive).
//
// With NO base (a first upload of this device's data, or a lost base): the local value wins where the two differ, because the person explicitly chose to upload it;
// fields only the server has are kept.

export type Data = Record<string, unknown>;

/** Structural equality of JSON values, whatever the order of keys. `undefined` object members count as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ao = a as Data;
  const bo = b as Data;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export interface Merged {
  data: Data;
  /** the fields both sides changed to different values (the local value was kept) */
  conflicts: string[];
}

export function mergeData(base: Data | null, local: Data, remote: Data): Merged {
  const out: Data = {};
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base ?? {})]);
  for (const k of keys) {
    const l = local[k];
    const r = remote[k];
    let pick: unknown;
    if (deepEqual(l, r)) pick = l;
    else if (base) {
      const b = base[k];
      if (deepEqual(l, b)) pick = r; // only the server changed it
      else if (deepEqual(r, b)) pick = l; // only this device changed it
      else {
        pick = l; // both changed it: the later syncer (this device) wins
        conflicts.push(k);
      }
    } else {
      pick = l === undefined ? r : l; // no base: the device's value wins, the server's extra fields stay
    }
    if (pick !== undefined) out[k] = clone(pick);
  }
  return { data: out, conflicts };
}
