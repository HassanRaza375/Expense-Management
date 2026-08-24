<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Wallet, PiggyBank, CalendarClock, BellRing, Gauge, Flame, Crown, TrendingUp, TrendingDown, CalendarDays, Wrench, Banknote, Percent, ReceiptText, Package, HandCoins, Zap, Droplet, ChartCandlestick } from '@lucide/vue'
import { useBudget } from '../composables/useBudget.js'
import { useSettings } from '../composables/useSettings.js'
import { useRecurring } from '../composables/useRecurring.js'
import { useExpenses } from '../composables/useExpenses.js'
import { useVehicles } from '../composables/useVehicles.js'
import { useVehicleMaintenance } from '../composables/useVehicleMaintenance.js'
import { useVehicleTags } from '../composables/useVehicleTags.js'
import { useFuelLogs } from '../composables/useFuelLogs.js'
import { useBills, useConnections } from '../composables/useBills.js'
import { useMeterReadings } from '../composables/useMeterReadings.js'
import { useAssets } from '../composables/useAssets.js'
import { useLending } from '../composables/useLending.js'
import { useInvestments } from '../composables/useInvestments.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs/index.js'
import CycleRail from '../components/CycleRail.vue'
import StatCard from '../components/StatCard.vue'
import DonutChart from '../components/DonutChart.vue'
import TrendChart from '../components/TrendChart.vue'
import RecurringConfirmCard from '../components/RecurringConfirmCard.vue'

const router = useRouter()

const { settings } = useSettings()
const budget = useBudget()
const { getPending, sortedByDueDate, stampConfirmed } = useRecurring()
const { addExpense, expenses, groupedByDay, groupedByWeek, groupedByMonth } = useExpenses()
const { vehicles } = useVehicles()
const { logs: maintenanceLogs, dueSoon } = useVehicleMaintenance()
const { findById: findTag } = useVehicleTags()
const { fuelLogs, monthlyCostForVehicle } = useFuelLogs()
const { bills, outstandingAmount, unpaidCount, overdueCount } = useBills()
const { meteredConnections } = useConnections()
const { readingsForConnection, unitsSinceLast } = useMeterReadings()
const { assets, totalValue: totalAssetValue } = useAssets()
const { loans, totalOutstanding: totalLoansOutstanding } = useLending()
const owedToYou = computed(() => totalLoansOutstanding('lent'))
const youOwe = computed(() => totalLoansOutstanding('borrowed'))
const { funds, currentValue: fundCurrentValue, profitLoss: fundProfitLoss, profitLossPercent: fundProfitLossPercent, changeSinceLast: fundChangeSinceLast } = useInvestments()

const hasMoneyOverviewData = computed(() => bills.length > 0 || assets.length > 0 || loans.length > 0)

const pending = computed(() => getPending(budget.cycle.value))
const upcomingDueDates = computed(() =>
  sortedByDueDate(budget.cycle.value)
    .slice(0, 5)
    .map((t) => t.dueDay)
    .map((day) => new Date(budget.cycle.value.start.getFullYear(), budget.cycle.value.start.getMonth(), day))
)

const viewMode = ref('day')

const trendPoints = computed(() => {
  if (viewMode.value === 'week') {
    return groupedByWeek(budget.cycleExpenses.value)
      .slice()
      .reverse()
      .map((g) => ({ date: g.week, total: g.total }))
  }
  if (viewMode.value === 'month') {
    return groupedByMonth(expenses)
      .slice(0, 6)
      .slice()
      .reverse()
      .map((g) => ({ date: g.month + '-01', total: g.total }))
  }
  return groupedByDay(budget.cycleExpenses.value)
    .slice()
    .reverse()
    .map((g) => ({ date: g.day, total: g.total }))
})

const donutSegments = computed(() =>
  budget.categoryBreakdown.value
    .filter((c) => c.spent > 0)
    .map((c) => ({ label: c.category.name, value: c.spent, color: c.category.color }))
)

const hasAnyData = computed(
  () =>
    budget.cycleExpenses.value.length > 0 ||
    budget.cycleIncome.value > 0 ||
    bills.length > 0 ||
    assets.length > 0 ||
    loans.length > 0 ||
    vehicles.length > 0 ||
    meteredConnections().length > 0 ||
    funds.length > 0
)

function inCycle(date) {
  return budget.cycle.value && new Date(date) >= budget.cycle.value.start && new Date(date) <= budget.cycle.value.end
}
const vehicleCycleCost = computed(
  () =>
    maintenanceLogs.filter((l) => inCycle(l.date)).reduce((sum, l) => sum + (l.cost || 0), 0) +
    fuelLogs.filter((l) => inCycle(l.date)).reduce((sum, l) => sum + (l.cost || 0), 0)
)
const upcomingMaintenance = computed(() => dueSoon().slice(0, 3))

const METER_TYPE_ICONS = { electricity: Zap, gas: Flame, water: Droplet }
function latestReadingFor(connectionId) {
  return readingsForConnection(connectionId)[0] || null
}

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

    <section v-if="upcomingMaintenance.length" class="flex flex-col gap-3">
      <h2 class="flex items-center gap-2 text-base font-semibold">
        <Wrench class="h-4 w-4 text-status-warn" /> Maintenance due soon
      </h2>
      <div class="flex flex-col gap-2">
        <Card v-for="log in upcomingMaintenance" :key="log.id" class="cursor-pointer" @click="router.push('/vehicles/' + log.vehicleId)">
          <CardContent class="flex items-center justify-between p-3">
            <span class="text-sm">{{ findTag(log.tagId)?.name || 'Odometer reading' }}<span v-if="log.title"> — {{ log.title }}</span></span>
            <span class="text-xs text-muted-foreground">
              <span v-if="log.nextDueDate">by {{ formatDate(log.nextDueDate, 'short') }}</span>
              <span v-if="log.nextDueOdometer"> · at {{ log.nextDueOdometer.toLocaleString() }} km</span>
            </span>
          </CardContent>
        </Card>
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
        <StatCard :icon="Banknote" label="Income this cycle" :value="formatCurrency(budget.cycleIncome.value, settings.currencySymbol)" />
        <StatCard
          :icon="budget.netCashflow.value >= 0 ? TrendingUp : TrendingDown"
          label="Net cashflow"
          :value="formatCurrency(budget.netCashflow.value, settings.currencySymbol)"
          :status="budget.netCashflow.value >= 0 ? 'good' : 'over'"
          sub="Income − spent"
        />
        <StatCard
          :icon="Percent"
          label="Savings rate"
          :value="budget.cycleIncome.value > 0 ? budget.savingsRate.value.toFixed(0) + '%' : '—'"
          :status="budget.savingsRate.value >= 0 ? 'good' : 'over'"
        />
        <StatCard :icon="Wallet" label="Spent this cycle" :value="formatCurrency(budget.cycleSpent.value, settings.currencySymbol)" />
      </section>

      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          :icon="CalendarDays"
          label="Daily average"
          :value="formatCurrency(budget.dailyAverageThisCycle.value, settings.currencySymbol)"
          sub="This cycle"
        />
        <StatCard
          v-if="budget.highestSpendDay.value"
          :icon="Flame"
          label="Highest spend day"
          :value="formatCurrency(budget.highestSpendDay.value.total, settings.currencySymbol)"
          :sub="formatDate(budget.highestSpendDay.value.day, 'short')"
        />
      </section>

      <section v-if="vehicles.length" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard :icon="Wallet" label="Vehicles tracked" :value="String(vehicles.length)" />
        <StatCard label="Vehicle spend this cycle" :value="formatCurrency(vehicleCycleCost, settings.currencySymbol)" />
        <StatCard :icon="Wrench" label="Maintenance due soon" :value="String(dueSoon().length)" :status="dueSoon().length ? 'warn' : ''" />
      </section>

      <section v-if="vehicles.length" class="flex flex-col gap-3">
        <h3 class="text-base font-semibold">Fuel spend by month</h3>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card v-for="vehicle in vehicles" :key="vehicle.id">
            <CardContent class="p-4">
              <h4 class="mb-3 text-sm font-semibold">{{ vehicle.name }}</h4>
              <TrendChart :points="monthlyCostForVehicle(vehicle.id, 6).map((m) => ({ date: m.month + '-01', total: m.total }))" />
            </CardContent>
          </Card>
        </div>
      </section>

      <section v-if="hasMoneyOverviewData" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          :icon="ReceiptText"
          label="Bills outstanding"
          :value="formatCurrency(outstandingAmount(), settings.currencySymbol)"
          :sub="overdueCount() ? overdueCount() + ' overdue' : unpaidCount() + ' unpaid'"
          :status="overdueCount() ? 'over' : unpaidCount() ? 'warn' : 'good'"
        />
        <StatCard :icon="Package" label="Assets owned" :value="formatCurrency(totalAssetValue(), settings.currencySymbol)" />
        <StatCard :icon="HandCoins" label="Owed to you" :value="formatCurrency(owedToYou, settings.currencySymbol)" sub="Money you've lent" status="good" />
        <StatCard :icon="HandCoins" label="You owe" :value="formatCurrency(youOwe, settings.currencySymbol)" sub="Money you've borrowed" :status="youOwe > 0 ? 'warn' : 'good'" />
      </section>

      <section v-if="meteredConnections().length" class="flex flex-col gap-3">
        <h3 class="text-base font-semibold">Meter readings</h3>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card
            v-for="c in meteredConnections()"
            :key="c.id"
            class="cursor-pointer transition-colors hover:border-primary"
            @click="router.push('/bills/meters/' + c.id)"
          >
            <CardContent class="flex min-w-0 flex-col gap-1 p-4">
              <div class="flex items-center gap-2">
                <component :is="METER_TYPE_ICONS[c.billType] || Gauge" class="h-3.5 w-3.5 text-muted-foreground" />
                <span class="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ c.connectionName }}</span>
              </div>
              <div class="amount overflow-hidden text-ellipsis text-2xl font-semibold">
                {{ latestReadingFor(c.id) ? latestReadingFor(c.id).reading.toLocaleString() : '—' }}
              </div>
              <div class="text-xs text-muted-foreground">
                <span v-if="unitsSinceLast(c.id) != null">{{ unitsSinceLast(c.id) >= 0 ? '+' : '' }}{{ unitsSinceLast(c.id) }} since last</span>
                <span v-else>No readings yet</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section v-if="funds.length" class="flex flex-col gap-3">
        <h3 class="text-base font-semibold">Investments</h3>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            v-for="fund in funds"
            :key="fund.id"
            :icon="ChartCandlestick"
            :label="fund.name"
            :value="(fundProfitLoss(fund) >= 0 ? '+' : '') + fundProfitLossPercent(fund).toFixed(1) + '%'"
            :sub="
              fundChangeSinceLast(fund) != null
                ? (fundChangeSinceLast(fund) >= 0 ? '+' : '') + formatCurrency(fundChangeSinceLast(fund), settings.currencySymbol) + ' since last'
                : formatCurrency(fundCurrentValue(fund), settings.currencySymbol)
            "
            :status="fundProfitLoss(fund) >= 0 ? 'good' : 'over'"
            class="cursor-pointer transition-colors hover:border-primary"
            @click="router.push('/investments/' + fund.id)"
          />
        </div>
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
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-sm font-semibold">Spending trend</h3>
              <Tabs v-model="viewMode">
                <TabsList>
                  <TabsTrigger value="day">Day</TabsTrigger>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="month">Month</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <TrendChart :points="trendPoints" />
          </CardContent>
        </Card>
      </section>
    </template>
  </div>
</template>
