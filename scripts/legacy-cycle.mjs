// REFERENCE ONLY (tests). Faithful copies of the ORIGINAL cycle helpers that used to live in app/utils/date.js, kept so
// the parity tests can prove the new day-key math gives identical results for reset days 1-28 and so the known defects
// of the originals stay documented and demonstrable. Nothing in app/ may import this file.

export const MS_DAY = 24 * 60 * 60 * 1000

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function clampDate(date, min, max) {
  if (date < min) return min
  if (date > max) return max
  return date
}

// Defect: new Date(y, m, 29..31) overflows into the next month for short months.
export function getCycle(date, resetDay) {
  const day = date.getDate()
  const start =
    day >= resetDay
      ? new Date(date.getFullYear(), date.getMonth(), resetDay)
      : new Date(date.getFullYear(), date.getMonth() - 1, resetDay)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, resetDay - 1)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

// Defect: setMonth overflows for reset days 29-31.
export function getAdjacentCycle(cycleStart, resetDay, direction) {
  const ref = new Date(cycleStart)
  ref.setMonth(ref.getMonth() + direction)
  return getCycle(ref, resetDay)
}

// Defect: `end` is 23:59:59.999, so round(end - start) rounds UP and +1 makes every cycle one day too long (31 for 30 days).
export function daysInCycle(cycle) {
  return Math.round((cycle.end - cycle.start) / MS_DAY) + 1
}

// Defect: floor of a millisecond difference is one day short across a spring-forward (a 23-hour day) in DST zones.
export function daysElapsed(cycle, today = new Date()) {
  const t = clampDate(today, cycle.start, cycle.end)
  return Math.floor((startOfDay(t) - startOfDay(cycle.start)) / MS_DAY) + 1
}

export function isWithinCycle(date, cycle) {
  const d = new Date(date)
  return d >= cycle.start && d <= cycle.end
}
