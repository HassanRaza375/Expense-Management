// Date helpers that do NOT define budget cycles. Cycles, "which day is this transaction on" and day counting all live
// in utils/reporting.js (pure local-day key math); the old getCycle / getAdjacentCycle / isWithinCycle / daysInCycle /
// daysElapsed were removed because they overflowed for reset days 29-31, counted cycles one day too long, and compared
// milliseconds across DST changes. Faithful copies of them are kept ONLY in scripts/legacy-cycle.mjs as the reference
// the parity tests compare against.

export function clampDueDay(dueDay, year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return Math.min(dueDay, lastDay)
}

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function formatDate(date, style = 'short') {
  const d = new Date(date)
  if (style === 'short') {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }
  if (style === 'long') {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  return d.toLocaleDateString('en-GB')
}

export function formatCycleLabel(cycle) {
  const startStr = cycle.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const endStr = cycle.end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${startStr} – ${endStr}`
}

export function toInputDate(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const MS_DAY = 24 * 60 * 60 * 1000
