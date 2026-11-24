// ---------------------------------------------------------------------------
// Savings goals (Phase 5). Pure: no Vue, no storage. Depends only on reporting.js for local day keys.
//
// A goal is { id, name, targetAmount, targetDate ('YYYY-MM-DD' | null), startDay ('YYYY-MM-DD'), accountId?, savings: [...] }.
// PROGRESS comes from ONE of two places:
//   * a linked account: the account's balance today (a goal "follows" an account, e.g. an emergency-fund account), or
//   * manual savings: the sum of the goal's own `savings` entries (positive = put aside, negative = taken out).
// If the linked account no longer exists the goal falls back to its manual savings and says so (`accountMissing`).
//
// STATUS is about the schedule only (never about the owner's behaviour):
//   reached  saved >= target
//   no-date  no target date was set
//   overdue  the target date has passed and the goal is not reached
//   on-track the share saved is at least the share of the time that has passed (start -> target date)
//   behind   the share saved is below the share of the time that has passed
// All sums use integer cents.
// ---------------------------------------------------------------------------
import { localDayKey, isDayKey, diffDays } from './reporting.js'

const toCents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fromCents = (c) => c / 100
const list = (x) => (Array.isArray(x) ? x.filter((r) => r !== null && typeof r === 'object') : [])

/** Problems with a goal being created or edited, as plain sentences ([] = fine). */
export function validateGoal(input = {}) {
  const errors = []
  if (!String(input.name ?? '').trim()) errors.push('Give the goal a name')
  if (!(Number(input.targetAmount) > 0)) errors.push('The target amount must be greater than 0')
  const start = input.startDay
  if (start !== undefined && start !== null && start !== '' && !isDayKey(start)) errors.push('The start day is not a valid date')
  const td = input.targetDate
  if (td !== undefined && td !== null && td !== '') {
    if (!isDayKey(td)) errors.push('The target date is not a valid date')
    else if (isDayKey(start) && td < start) errors.push('The target date cannot be before the start day')
  }
  return errors
}

/** Sum of a goal's manual savings, floored at 0 (taking out more than was put in never shows negative progress). */
export function manualSaved(goal) {
  const c = list(goal?.savings).reduce((s, e) => s + toCents(e.amount), 0)
  return fromCents(Math.max(0, c))
}

/**
 * Where a goal stands today.
 * `accountBalance` = the linked account's balance today, or null/undefined when the goal has no account or it no longer exists.
 * Returns { saved, target, pct (0-100, for the bar), pctRaw, remaining, reached, source: 'account' | 'manual',
 *           accountMissing, daysLeft, requiredPerMonth, expectedPct, status }.
 */
export function goalProgress(goal, { accountBalance = null, now = new Date() } = {}) {
  const today = localDayKey(now)
  if (today === null) throw new TypeError('Invalid "now" date')
  const targetC = toCents(goal?.targetAmount)
  const wantsAccount = !!goal?.accountId
  const hasBalance = accountBalance !== null && accountBalance !== undefined && Number.isFinite(Number(accountBalance))
  const source = wantsAccount && hasBalance ? 'account' : 'manual'
  const savedC = source === 'account' ? Math.max(0, toCents(accountBalance)) : toCents(manualSaved(goal))
  const reached = targetC > 0 && savedC >= targetC
  const remainingC = Math.max(0, targetC - savedC)
  const pctRaw = targetC > 0 ? (savedC / targetC) * 100 : 0

  const targetDate = isDayKey(goal?.targetDate) ? goal.targetDate : null
  const startDay = isDayKey(goal?.startDay) ? goal.startDay : localDayKey(goal?.createdAt) || today
  let daysLeft = null
  let requiredPerMonth = null
  let expectedPct = null
  let status
  if (reached) status = 'reached'
  else if (targetDate === null) status = 'no-date'
  else if (today > targetDate) status = 'overdue'
  else {
    daysLeft = diffDays(today, targetDate)
    const months = Math.max(1, Math.ceil(daysLeft / 30))
    requiredPerMonth = fromCents(Math.ceil(remainingC / months))
    const total = diffDays(startDay, targetDate)
    const elapsed = Math.min(Math.max(diffDays(startDay, today), 0), Math.max(total, 0))
    expectedPct = total > 0 ? (elapsed / total) * 100 : 100
    status = pctRaw + 1e-9 >= expectedPct ? 'on-track' : 'behind'
  }
  if (targetDate !== null && daysLeft === null && today <= targetDate) daysLeft = diffDays(today, targetDate)

  return {
    saved: fromCents(savedC),
    target: fromCents(targetC),
    pct: Math.min(100, Math.max(0, pctRaw)),
    pctRaw,
    remaining: fromCents(remainingC),
    reached,
    source,
    accountMissing: wantsAccount && !hasBalance,
    daysLeft,
    requiredPerMonth,
    expectedPct,
    status,
  }
}

export const GOAL_STATUS_LABELS = { reached: 'Reached', 'on-track': 'On track', behind: 'Behind schedule', overdue: 'Past its date', 'no-date': 'No date set' }
