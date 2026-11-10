<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Landmark, Package, ChartCandlestick, HandCoins, TrendingUp, TrendingDown, TriangleAlert } from '@lucide/vue'
import { useAccounts } from '../composables/useAccounts.js'
import { useAssets } from '../composables/useAssets.js'
import { useExpenses } from '../composables/useExpenses.js'
import { useIncome } from '../composables/useIncome.js'
import { useLending } from '../composables/useLending.js'
import { useInvestments } from '../composables/useInvestments.js'
import { useSettings } from '../composables/useSettings.js'
import { netWorthAt, netWorthSeries, unlinkedInvestmentCount, cashFlowByCycle } from '../utils/netWorth.js'
import { sanitizeResetDay } from '../utils/budgetMath.js'
import { localDayKey, cycleLabel } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import StatCard from '../components/StatCard.vue'
import NetWorthChart from '../components/NetWorthChart.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'

const router = useRouter()
const { store } = useAccounts()
const { assets } = useAssets()
const { expenses } = useExpenses()
const { income } = useIncome()
const { loans } = useLending()
const { funds } = useInvestments()
const { settings } = useSettings()

const money = (n) => formatCurrency(n, settings.currencySymbol).replace(/^-/, '−')
const resetDay = computed(() => sanitizeResetDay(settings.cycleResetDay))

// Everything below is a pure function of the raw records (utils/netWorth.js); nothing is stored.
const inputs = computed(() => ({ accounts: store, expenses, income, loans, funds, assets }))
const today = computed(() => localDayKey(new Date()))
const now = computed(() => netWorthAt(today.value, inputs.value))
const series = computed(() => netWorthSeries(inputs.value, { months: 12 }))
const flow = computed(() => cashFlowByCycle({ expenses, income, resetDay: resetDay.value, cycles: 6 }))
const unlinked = computed(() => unlinkedInvestmentCount(inputs.value))

// change since the end of last month (the last point before today's)
const change = computed(() => {
  const pts = series.value
  if (pts.length < 2) return null
  const prev = pts[pts.length - 2]
  return { amount: now.value.total - prev.total, since: prev.dayKey }
})

const parts = computed(() => [
  { key: 'accounts', label: 'Accounts', value: now.value.accounts, icon: Landmark, to: '/accounts', sub: now.value.accountList.length + (now.value.accountList.length === 1 ? ' account' : ' accounts') },
  { key: 'assets', label: 'Assets', value: now.value.assets, icon: Package, to: '/assets', sub: 'At their current value' },
  { key: 'investments', label: 'Investments', value: now.value.investments, icon: ChartCandlestick, to: '/investments', sub: funds.length + (funds.length === 1 ? ' fund' : ' funds') },
  { key: 'receivable', label: 'Owed to you', value: now.value.receivable, icon: HandCoins, to: '/lending', sub: 'Loans you made' },
  { key: 'payable', label: 'You owe', value: -now.value.payable, icon: HandCoins, to: '/lending', sub: 'Money you borrowed' },
])

const rate = (r) => (r === null ? '—' : r.toFixed(0) + '%')
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <h2 class="font-display text-xl">Net worth</h2>
      <p class="mt-1 text-sm text-muted-foreground">Everything you have, minus everything you owe, worked out from your records.</p>
    </div>

    <Card v-if="!now.tracked">
      <CardContent class="flex flex-col items-center gap-3 p-10 text-center">
        <p class="m-0 font-medium">Nothing to add up yet</p>
        <p class="m-0 max-w-md text-sm text-muted-foreground">Add an account, an asset or an investment fund and your net worth appears here.</p>
        <div class="flex flex-wrap justify-center gap-2">
          <Button @click="router.push('/accounts')">Add an account</Button>
          <Button variant="outline" @click="router.push('/assets')">Add an asset</Button>
          <Button variant="outline" @click="router.push('/investments')">Add a fund</Button>
        </div>
      </CardContent>
    </Card>

    <template v-else>
      <Card>
        <CardContent class="flex flex-col gap-1 p-4">
          <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net worth today</div>
          <div class="amount text-3xl font-semibold" data-testid="net-worth-total">{{ money(now.total) }}</div>
          <div v-if="change" class="flex items-center gap-1 text-sm" :class="change.amount >= 0 ? 'text-status-good' : 'text-status-over'" data-testid="net-worth-change">
            <component :is="change.amount >= 0 ? TrendingUp : TrendingDown" class="h-4 w-4" aria-hidden="true" />
            {{ change.amount >= 0 ? 'Up' : 'Down' }} {{ money(Math.abs(change.amount)) }} since the end of last month
          </div>
        </CardContent>
      </Card>

      <section class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="net-worth-parts">
        <RouterLink v-for="part in parts" :key="part.key" :to="part.to" class="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <StatCard :icon="part.icon" :label="part.label" :value="money(part.value)" :sub="part.sub" />
        </RouterLink>
      </section>

      <p v-if="unlinked" class="m-0 flex gap-2 rounded-md border border-border p-3 text-sm" role="note" data-testid="unlinked-note">
        <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-status-warn" aria-hidden="true" />
        <span>
          {{ unlinked }} fund contribution{{ unlinked === 1 ? '' : 's' }} {{ unlinked === 1 ? "doesn't" : "don't" }} say which account the money came from. If it was still counted in an account, it is counted twice here.
          Open the fund and choose the account on the contribution.
        </span>
      </p>

      <Card>
        <CardContent class="p-4">
          <h3 class="mb-3 text-sm font-semibold">Net worth over time</h3>
          <NetWorthChart :points="series" />
          <p class="m-0 mt-2 text-xs text-muted-foreground">
            Month-end figures. Assets only keep their current value, so each is counted at that value from its purchase date. A fund is counted at its last value update, so log a new value after you add money to it.
          </p>
        </CardContent>
      </Card>

      <Card v-if="now.accountList.length">
        <CardContent class="flex flex-col gap-2 p-4">
          <h3 class="m-0 text-sm font-semibold">By account</h3>
          <div v-for="a in now.accountList" :key="a.id" class="flex items-center justify-between gap-2 text-sm" data-testid="nw-account">
            <RouterLink :to="'/accounts/' + a.id" class="truncate underline-offset-2 hover:underline">{{ a.name }}</RouterLink>
            <span class="amount whitespace-nowrap" :class="a.balance < 0 ? 'text-muted-foreground' : ''">{{ a.type === 'card' && a.balance < 0 ? 'Owed ' + money(-a.balance) : money(a.balance) }}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="flex flex-col gap-3 p-4">
          <div>
            <h3 class="m-0 text-sm font-semibold">Cash flow by budget cycle</h3>
            <p class="m-0 text-xs text-muted-foreground">Income minus spending (refunds taken off), for the last six cycles. The current cycle matches the Dashboard.</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[26rem] text-sm" data-testid="cash-flow">
              <thead>
                <tr class="text-left text-xs text-muted-foreground">
                  <th class="py-1 pr-2 font-medium">Cycle</th>
                  <th class="px-2 py-1 text-right font-medium">Income</th>
                  <th class="px-2 py-1 text-right font-medium">Spent</th>
                  <th class="px-2 py-1 text-right font-medium">Left</th>
                  <th class="py-1 pl-2 text-right font-medium">Saved</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in flow" :key="row.startKey" class="border-t border-border" data-testid="cash-flow-row">
                  <td class="py-2 pr-2">
                    {{ cycleLabel(row) }} <Badge v-if="row.isCurrent" variant="secondary">Now</Badge>
                  </td>
                  <td class="amount px-2 py-2 text-right">{{ money(row.income) }}</td>
                  <td class="amount px-2 py-2 text-right">{{ money(row.spent) }}</td>
                  <td class="amount px-2 py-2 text-right" :class="row.net < 0 ? 'text-status-over' : ''">{{ money(row.net) }}</td>
                  <td class="amount py-2 pl-2 text-right">{{ rate(row.savingsRate) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
