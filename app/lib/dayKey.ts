// Day keys ('YYYY-MM-DD') as the SERVER sees them (docs/DECISIONS.md D17). The browser computes a record's local day with `localDayKey` (app/utils/reporting.js) and sends it
// along; the server never works out a day or a month from a timestamp in its own time zone. All it may do with a key is check that it is well formed and a real calendar
// date, and group by its text (`left(dayKey, 7)` is the month, `left(dayKey, 4)` the year).

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day in 1900-2199 written exactly as YYYY-MM-DD (so '2026-02-30', '2026-13-01' and '2026-1-5' are all refused). */
export function isRealDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = SHAPE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2199 || mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // day 0 of the next month = last day of this one (pure calendar arithmetic, no time zone)
  return d <= days;
}

export const monthOf = (dayKey: string): string => dayKey.slice(0, 7);
export const yearOf = (dayKey: string): string => dayKey.slice(0, 4);

/** Money in integer minor units (amount * 100, rounded), as the projection columns store it. Throws for anything that is not a finite number. */
export function toMinorUnits(amount: unknown): bigint {
  const n = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() !== "" ? Number(amount) : NaN;
  if (!Number.isFinite(n)) throw new RangeError("amount must be a finite number");
  return BigInt(Math.round(n * 100));
}
