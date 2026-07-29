<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Wallet, PiggyBank, CalendarClock, BellRing, Gauge, Flame, Crown, TrendingUp } from '@lucide/vue'
import { useBudget } from '../composables/useBudget.js'
import { useSettings } from '../composables/useSettings.js'
import { useRecurring } from '../composables/useRecurring.js'
import { useExpenses } from '../composables/useExpenses.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import CycleRail from '../components/CycleRail.vue'
import StatCard from '../components/StatCard.vue'
import DonutChart from '../components/DonutChart.vue'
import TrendChart from '../components/TrendChart.vue'
import RecurringConfirmCard from '../components/RecurringConfirmCard.vue'

const router = useRouter()

const { settings } = useSettings()
const budget = useBudget()
const { getPending, sortedByDueDate, stampConfirmed } = useRecurring()
const { addExpense, groupedByDay } = useExpenses()

const pending = computed(() => getPending(budget.cycle.value))
const upcomingDueDates = computed(() =>
  sortedByDueDate(budget.cycle.value)
    .slice(0, 5)
    .map((t) => t.dueDay)
    .map((day) => new Date(budget.cycle.value.start.getFullYear(), budget.cycle.value.start.getMonth(), day))
)

const trendPoints = computed(() => {
  const groups = groupedByDay(budget.cycleExpenses.value)
  return groups
    .slice()
    .reverse()
    .map((g) => ({ date: g.day, total: g.total }))
})

const donutSegments = computed(() =>
  budget.categoryBreakdown.value
    .filter((c) => c.spent > 0)
    .map((c) => ({ label: c.category.name, value: c.spent, color: c.category.color }))
)

const hasAnyData = computed(() => budget.cycleExpenses.value.length > 0)

function handleAdd(template, amount) {
  addExpense({
    date: new Date().toISOString(),
    amount,
    categoryId: template.categoryId,
    note: `Recurring: ${template.name}`,
    source: 'recurring',
    recurringId: template.id,
  })
  stampConfirmed(template.id, budget.cycle.value.start)
}

function handleSkip(template) {
  stampConfirmed(template.id, budget.cycle.value.start)
}

function handleSnooze() {
  // no stamp — re-prompts next load
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <section v-if="pending.length" class="flex flex-col gap-3">
      <h2 class="flex items-center gap-2 text-base font-semibold">
        <BellRing class="h-4 w-4 text-status-warn" /> Pending confirmations
      </h2>
      <div class="flex flex-col gap-2">
        <RecurringConfirmCard
          v-for="tpl in pending"
          :key="tpl.id"
          :template="tpl"
          @add="(amount) => handleAdd(tpl, amount)"
          @skip="handleSkip(tpl)"
          @snooze="handleSnooze(tpl)"
        />
      </div>
    </section>

    <Card>
      <CardContent class="p-4">
        <CycleRail :cycle="budget.cycle.value" :is-over-budget="budget.overallStatus.value === 'over'" :due-ticks="upcomingDueDates" />
      </CardContent>
    </Card>

    <Card v-if="!hasAnyData">
      <CardContent class="flex flex-col items-center gap-3 p-14 text-center">
        <h2 class="font-display text-xl">Nothing tracked yet this cycle</h2>
        <p class="m-0 text-muted-foreground">Add your first expense to see your dashboard come alive.</p>
        <Button @click="router.push('/expenses')">Add an expense</Button>
      </CardContent>
    </Card>

    <template v-else>
      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard :icon="Wallet" label="Spent this cycle" :value="formatCurrency(budget.cycleSpent.value, settings.currencySymbol)" />
        <StatCard
          :icon="PiggyBank"
          label="Remaining"
          :value="formatCurrency(budget.overallRemaining.value, settings.currencySymbol)"
          :status="budget.overallStatus.value"
        />
        <StatCard :icon="CalendarClock" label="Days left" :value="String(budget.daysLeftInCycle.value)" />
        <StatCard :icon="BellRing" label="Pending recurring" :value="String(pending.length)" />
      </section>

      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          :icon="Gauge"
          label="Safe to spend / day"
          :value="formatCurrency(budget.safeToSpendPerDay.value, settings.currencySymbol)"
          sub="Remaining ÷ days left"
        />
        <StatCard
          v-if="budget.biggestExpense.value"
          :icon="Flame"
          label="Biggest expense"
          :value="formatCurrency(budget.biggestExpense.value.amount, settings.currencySymbol)"
          :sub="formatDate(budget.biggestExpense.value.date, 'short')"
        />
        <StatCard
          v-if="budget.topCategory.value"
          :icon="Crown"
          label="Top category"
          :value="budget.topCategory.value.category.name"
          :sub="formatCurrency(budget.topCategory.value.spent, settings.currencySymbol)"
        />
        <StatCard
          :icon="TrendingUp"
          label="vs last cycle"
          :value="(budget.cycleOverCycleChange.value >= 0 ? '+' : '') + budget.cycleOverCycleChange.value.toFixed(0) + '%'"
          :status="budget.cycleOverCycleChange.value > 0 ? 'warn' : 'good'"
        />
      </section>

      <section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent class="p-4">
            <h3 class="mb-3 text-sm font-semibold">By category</h3>
            <DonutChart :segments="donutSegments" />
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <h3 class="mb-3 text-sm font-semibold">Daily trend</h3>
            <TrendChart :points="trendPoints" />
          </CardContent>
        </Card>
      </section>
    </template>
  </div>
</template>
