import { computed } from 'vue'
import { useSettings } from './useSettings.js'
import { useExpenses } from './useExpenses.js'
import { useCategories } from './useCategories.js'
import { getCycle, getAdjacentCycle, daysLeft } from '../utils/date.js'

export function statusForPercent(percent) {
  if (percent > 100) return 'over'
  if (percent >= 80) return 'warn'
  return 'good'
}

export function useBudget(referenceDate = new Date()) {
  const { settings } = useSettings()
  const { expenses, inCycle } = useExpenses()
  const { categories } = useCategories()

  const cycle = computed(() => getCycle(referenceDate, settings.cycleResetDay))
  const previousCycle = computed(() => getAdjacentCycle(cycle.value.start, settings.cycleResetDay, -1))

  const cycleExpenses = computed(() => inCycle(cycle.value))
  const previousCycleExpenses = computed(() =>
    expenses.filter((e) => {
      const d = new Date(e.date)
      return d >= previousCycle.value.start && d <= previousCycle.value.end
    })
  )

  const cycleSpent = computed(() => cycleExpenses.value.reduce((sum, e) => sum + e.amount, 0))
  const previousCycleSpent = computed(() => previousCycleExpenses.value.reduce((sum, e) => sum + e.amount, 0))

  const overallRemaining = computed(() => settings.overallBudget - cycleSpent.value)

  const daysLeftInCycle = computed(() => daysLeft(cycle.value, referenceDate))

  const safeToSpendPerDay = computed(() => {
    if (daysLeftInCycle.value <= 0) return Math.max(overallRemaining.value, 0)
    return overallRemaining.value / daysLeftInCycle.value
  })

  const overallStatus = computed(() => {
    if (!settings.overallBudget) return 'good'
    const percent = (cycleSpent.value / settings.overallBudget) * 100
    return statusForPercent(percent)
  })

  const overallPercentUsed = computed(() => {
    if (!settings.overallBudget) return 0
    return (cycleSpent.value / settings.overallBudget) * 100
  })

  const categoryBreakdown = computed(() => {
    return categories
      .map((cat) => {
        const spent = cycleExpenses.value
          .filter((e) => e.categoryId === cat.id)
          .reduce((sum, e) => sum + e.amount, 0)
        const budget = settings.categoryBudgets[cat.id] || 0
        const percentUsed = budget ? (spent / budget) * 100 : spent > 0 ? 100 : 0
        return {
          category: cat,
          spent,
          budget,
          remaining: budget - spent,
          percentUsed,
          status: statusForPercent(percentUsed),
        }
      })
      .sort((a, b) => b.percentUsed - a.percentUsed)
  })

  const cycleOverCycleChange = computed(() => {
    if (previousCycleSpent.value === 0) return cycleSpent.value > 0 ? 100 : 0
    return ((cycleSpent.value - previousCycleSpent.value) / previousCycleSpent.value) * 100
  })

  const topCategory = computed(() => {
    return categoryBreakdown.value.slice().sort((a, b) => b.spent - a.spent)[0] || null
  })

  const biggestExpense = computed(() => {
    return cycleExpenses.value.slice().sort((a, b) => b.amount - a.amount)[0] || null
  })

  const alerts = computed(() => {
    const list = []
    if (overallPercentUsed.value >= 100) list.push({ scope: 'overall', level: 'over', message: 'Over overall budget' })
    else if (overallPercentUsed.value >= 80) list.push({ scope: 'overall', level: 'warn', message: 'Nearing overall budget' })
    for (const c of categoryBreakdown.value) {
      if (!c.budget) continue
      if (c.percentUsed >= 100) list.push({ scope: c.category.id, level: 'over', message: `${c.category.name} over budget` })
      else if (c.percentUsed >= 80) list.push({ scope: c.category.id, level: 'warn', message: `${c.category.name} nearing budget` })
    }
    return list
  })

  function applyRollover() {
    if (!settings.rollover) return
    if (overallRemaining.value > 0) {
      settings.overallBudget += overallRemaining.value
    }
  }

  return {
    cycle,
    previousCycle,
    cycleExpenses,
    cycleSpent,
    previousCycleSpent,
    overallRemaining,
    daysLeftInCycle,
    safeToSpendPerDay,
    overallStatus,
    overallPercentUsed,
    categoryBreakdown,
    cycleOverCycleChange,
    topCategory,
    biggestExpense,
    alerts,
    applyRollover,
  }
}
