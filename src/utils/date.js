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

export function getAdjacentCycle(cycleStart, resetDay, direction) {
  const ref = new Date(cycleStart)
  ref.setMonth(ref.getMonth() + direction)
  return getCycle(ref, resetDay)
}

export function daysInCycle(cycle) {
  return Math.round((cycle.end - cycle.start) / MS_DAY) + 1
}

export function daysElapsed(cycle, today = new Date()) {
  const t = clampDate(today, cycle.start, cycle.end)
  return Math.floor((startOfDay(t) - startOfDay(cycle.start)) / MS_DAY) + 1
}

export function daysLeft(cycle, today = new Date()) {
  const total = daysInCycle(cycle)
  const elapsed = daysElapsed(cycle, today)
  return Math.max(total - elapsed, 0)
}

export function clampDueDay(dueDay, year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return Math.min(dueDay, lastDay)
}

export function isWithinCycle(date, cycle) {
  const d = new Date(date)
  return d >= cycle.start && d <= cycle.end
}

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
