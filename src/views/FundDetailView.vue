<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChartCandlestick, Plus, Pencil, Trash2 } from '@lucide/vue'
import { useInvestments } from '../composables/useInvestments.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import StatCard from '../components/StatCard.vue'
import TrendChart from '../components/TrendChart.vue'
import FundFormModal from '../components/FundFormModal.vue'
import ValueEntryFormModal from '../components/ValueEntryFormModal.vue'
import ContributionFormModal from '../components/ContributionFormModal.vue'

const route = useRoute()
const router = useRouter()
const { settings } = useSettings()
const {
  findById,
  updateFund,
  totalInvested,
  currentValue,
  profitLoss,
  profitLossPercent,
  changeSinceLast,
  sortedValueEntries,
  sortedContributions,
  valueHistory,
  addValueEntry,
  updateValueEntry,
  deleteValueEntry,
  addContribution,
  deleteContribution,
} = useInvestments()

const fund = computed(() => findById(route.params.id))
const trendPoints = computed(() => (fund.value ? valueHistory(fund.value).map((e) => ({ date: e.date, total: e.value })) : []))

const editModalOpen = ref(false)
const valueModalOpen = ref(false)
const editingValueEntry = ref(null)
const contributionModalOpen = ref(false)
const error = ref('')

function openEditFund() {
  error.value = ''
  editModalOpen.value = true
}

function saveFund(payload) {
  error.value = ''
  try {
    updateFund(fund.value.id, payload)
    editModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function openAddValue() {
  editingValueEntry.value = null
  error.value = ''
  valueModalOpen.value = true
}

function openEditValue(entry) {
  editingValueEntry.value = entry
  error.value = ''
  valueModalOpen.value = true
}

function saveValueEntry(payload) {
  error.value = ''
  try {
    if (editingValueEntry.value) {
      updateValueEntry(fund.value.id, editingValueEntry.value.id, payload)
    } else {
      addValueEntry(fund.value.id, payload)
    }
    valueModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDeleteValue(entryId) {
  deleteValueEntry(fund.value.id, entryId)
  toast('Value update removed')
}

function openAddContribution() {
  error.value = ''
  contributionModalOpen.value = true
}

function saveContribution(payload) {
  error.value = ''
  try {
    addContribution(fund.value.id, payload)
    contributionModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDeleteContribution(contributionId) {
  deleteContribution(fund.value.id, contributionId)
  toast('Contribution removed')
}
</script>

<template>
  <div v-if="!fund" class="flex flex-col items-center gap-3 p-14 text-center">
    <p class="text-muted-foreground">Fund not found.</p>
    <Button @click="router.push('/investments')">Back to Investments</Button>
  </div>

  <div v-else class="flex flex-col gap-4">
    <Button variant="ghost" size="sm" class="w-fit" @click="router.push('/investments')"><ArrowLeft class="h-4 w-4" /> Back to Investments</Button>

    <Card>
      <CardContent class="flex flex-wrap items-center justify-between gap-4 p-4">
        <div class="flex items-center gap-3">
          <ChartCandlestick class="h-6 w-6 text-primary" />
          <div>
            <h2 class="font-display text-xl">{{ fund.name }}</h2>
            <p class="m-0 text-sm text-muted-foreground">{{ fund.provider || 'No provider set' }}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" @click="openEditFund"><Pencil class="h-4 w-4" /> Edit</Button>
      </CardContent>
    </Card>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Total invested" :value="formatCurrency(totalInvested(fund), settings.currencySymbol)" />
      <StatCard label="Current value" :value="formatCurrency(currentValue(fund), settings.currencySymbol)" />
      <StatCard
        label="Profit / loss"
        :value="formatCurrency(profitLoss(fund), settings.currencySymbol)"
        :sub="profitLossPercent(fund).toFixed(1) + '%'"
        :status="profitLoss(fund) >= 0 ? 'good' : 'over'"
      />
      <StatCard
        label="Since last update"
        :value="changeSinceLast(fund) != null ? (changeSinceLast(fund) >= 0 ? '+' : '') + formatCurrency(changeSinceLast(fund), settings.currencySymbol) : '—'"
        :status="changeSinceLast(fund) == null ? '' : changeSinceLast(fund) >= 0 ? 'good' : 'over'"
      />
    </section>

    <p v-if="fund.notes" class="m-0 text-sm text-muted-foreground">{{ fund.notes }}</p>

    <Card v-if="trendPoints.length > 1">
      <CardContent class="p-4">
        <h3 class="mb-3 text-sm font-semibold">Value over time</h3>
        <TrendChart :points="trendPoints" />
      </CardContent>
    </Card>

    <Tabs default-value="values">
      <TabsList>
        <TabsTrigger value="values">Value updates</TabsTrigger>
        <TabsTrigger value="contributions">Contributions</TabsTrigger>
      </TabsList>

      <TabsContent value="values" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Value updates</h3>
          <Button size="sm" @click="openAddValue"><Plus class="h-4 w-4" /> Add value update</Button>
        </div>

        <Card v-if="!fund.valueEntries.length">
          <CardContent class="p-8 text-center text-muted-foreground"> No value updates yet. Log the fund's current worth periodically to track performance. </CardContent>
        </Card>

        <Card v-else class="overflow-hidden py-0">
          <div v-for="e in sortedValueEntries(fund)" :key="e.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <div class="min-w-0 flex-1">
              <div class="amount font-medium">{{ formatCurrency(e.value, settings.currencySymbol) }}</div>
              <div class="text-xs text-muted-foreground">
                {{ formatDate(e.date, 'short') }}
                <span v-if="e.notes"> · {{ e.notes }}</span>
              </div>
            </div>
            <div class="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" title="Edit" @click="openEditValue(e)"><Pencil class="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Delete" @click="handleDeleteValue(e.id)"><Trash2 class="h-4 w-4" /></Button>
            </div>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="contributions" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Contributions</h3>
          <Button size="sm" @click="openAddContribution"><Plus class="h-4 w-4" /> Add contribution</Button>
        </div>

        <Card v-if="!fund.contributions.length">
          <CardContent class="p-8 text-center text-muted-foreground"> No contributions logged yet. </CardContent>
        </Card>

        <Card v-else class="overflow-hidden py-0">
          <div v-for="c in sortedContributions(fund)" :key="c.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <div class="min-w-0 flex-1">
              <div class="amount font-medium">{{ formatCurrency(c.amount, settings.currencySymbol) }}</div>
              <div class="text-xs text-muted-foreground">
                {{ formatDate(c.date, 'short') }}
                <span v-if="c.notes"> · {{ c.notes }}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" title="Delete" class="ml-auto" @click="handleDeleteContribution(c.id)"><Trash2 class="h-4 w-4" /></Button>
          </div>
        </Card>
      </TabsContent>
    </Tabs>

    <FundFormModal :open="editModalOpen" :fund="fund" @close="editModalOpen = false" @save="saveFund" />
    <ValueEntryFormModal :open="valueModalOpen" :entry="editingValueEntry" @close="valueModalOpen = false" @save="saveValueEntry" />
    <ContributionFormModal :open="contributionModalOpen" @close="contributionModalOpen = false" @save="saveContribution" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
