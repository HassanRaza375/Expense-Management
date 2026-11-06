import { computed } from 'vue'
import { useSettings } from './useSettings.js'
import { useExpenses } from './useExpenses.js'
import { useCategories } from './useCategories.js'
import { useIncome } from './useIncome.js'
import { computeBudget, toDateCycle, sanitizeResetDay, statusForPercent } from '../utils/budgetMath.js'
import { dayInRange } from '../utils/reporting.js'

export { statusForPercent }

// Thin reactive wrapper. ALL arithmetic lives in utils/budgetMath.js (pure, tested); this file only feeds it
// the reactive state and re-shapes the result for the pages. Refunds reduce `spent` everywhere.
export function useBudget(referenceDate = new Date()) {
  const { settings } = useSettings()
  const { expenses } = useExpenses()
  const { categories } = useCategories()
  const { income: incomeState } = useIncome()

  const result = computed(() =>
    computeBudget({
      expenses,
      income: incomeState,
      overallBudget: settings.overallBudget,
      categoryBudgets: settings.categoryBudgets,
      categories,
      resetDay: sanitizeResetDay(settings.cycleResetDay),
      now: referenceDate,
    })
  )

  // Date-based cycle objects for components that still take Dates (CycleRail, recurring confirmations).
  const cycle = computed(() => toDateCycle(result.value.cycle))
  const previousCycle = computed(() => toDateCycle(result.value.previousCycle))
  // Day-key range for code that wants to test "is this date in the cycle" the local-day way.
  const cycleRange = computed(() => result.value.cycle)
  const inCycle = (date) => dayInRange(date, result.value.cycle)

  const cycleExpenses = computed(() => result.value.cycleList)
  const cycleSpent = computed(() => result.value.spent)
  const previousCycleSpent = computed(() => result.value.previousSpent)
  const cycleGross = computed(() => result.value.gross)
  const cycleRefunds = computed(() => result.value.refunds)

  const overallRemaining = computed(() => result.value.remaining)
  const daysLeftInCycle = computed(() => result.value.days.left)
  const safeToSpendPerDay = computed(() => result.value.safeToSpendPerDay)
  const overallStatus = computed(() => result.value.status)
  const overallPercentUsed = computed(() => result.value.percentUsed)

  const categoryBreakdown = computed(() =>
    result.value.categories.map((row) => ({ ...row, category: categories.find((c) => c.id === row.categoryId) })).filter((row) => row.category)
  )
  const unlistedSpent = computed(() => result.value.unlistedSpent)

  const cycleOverCycleChange = computed(() => result.value.cycleOverCycleChange)
  const topCategory = computed(() => {
    const top = result.value.topCategory
    return top ? { ...top, category: categories.find((c) => c.id === top.categoryId) } : null
  })
  const biggestExpense = computed(() => result.value.biggestExpense)
  const dailyAverageThisCycle = computed(() => result.value.dailyAverage)
  const highestSpendDay = computed(() => result.value.highestSpendDay)

  const cycleIncome = computed(() => result.value.cycleIncome)
  const netCashflow = computed(() => result.value.netCashflow)
  const savingsRate = computed(() => result.value.savingsRate)
  const alerts = computed(() => result.value.alerts)

  function applyRollover() {
    if (!settings.rollover) return
    if (overallRemaining.value > 0) {
      settings.overallBudget += overallRemaining.value
    }
  }

  return {
    cycle,
    previousCycle,
    cycleRange,
    inCycle,
    cycleExpenses,
    cycleSpent,
    cycleGross,
    cycleRefunds,
    previousCycleSpent,
    overallRemaining,
    daysLeftInCycle,
    safeToSpendPerDay,
    overallStatus,
    overallPercentUsed,
    categoryBreakdown,
    unlistedSpent,
    cycleOverCycleChange,
    topCategory,
    biggestExpense,
    dailyAverageThisCycle,
    highestSpendDay,
    cycleIncome,
    netCashflow,
    savingsRate,
    alerts,
    applyRollover,
  }
}
