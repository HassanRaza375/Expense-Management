<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, ChartCandlestick } from '@lucide/vue'
import { useInvestments } from '../composables/useInvestments.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import StatCard from '../components/StatCard.vue'
import FundFormModal from '../components/FundFormModal.vue'

const router = useRouter()
const { settings } = useSettings()
const { funds, addFund, deleteFund, undoDelete, totalInvested, currentValue, profitLoss, profitLossPercent, portfolioInvested, portfolioValue, portfolioProfitLoss } =
  useInvestments()

const modalOpen = ref(false)
const error = ref('')

function openAdd() {
  error.value = ''
  modalOpen.value = true
}

function handleSave(payload) {
  error.value = ''
  try {
    addFund(payload)
    modalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDelete(fund, event) {
  event.stopPropagation()
  deleteFund(fund.id)
  toast('Fund deleted', {
    action: { label: 'Undo', onClick: () => undoDelete() },
  })
}

const sortedFunds = computed(() => [...funds].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-xl">Investments</h2>
        <p class="mt-1 text-sm text-muted-foreground">Funds you've invested in, tracked by periodic value updates.</p>
      </div>
      <Button @click="openAdd"><Plus class="h-4 w-4" /> Add fund</Button>
    </div>

    <section v-if="funds.length" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Total invested" :value="formatCurrency(portfolioInvested(), settings.currencySymbol)" />
      <StatCard label="Current value" :value="formatCurrency(portfolioValue(), settings.currencySymbol)" />
      <StatCard
        label="Profit / loss"
        :value="formatCurrency(portfolioProfitLoss(), settings.currencySymbol)"
        :status="portfolioProfitLoss() >= 0 ? 'good' : 'over'"
      />
      <StatCard
        label="Overall return"
        :value="portfolioInvested() > 0 ? ((portfolioProfitLoss() / portfolioInvested()) * 100).toFixed(1) + '%' : '—'"
        :status="portfolioProfitLoss() >= 0 ? 'good' : 'over'"
      />
    </section>

    <Card v-if="!sortedFunds.length">
      <CardContent class="p-8 text-center text-muted-foreground"> No funds yet. Add one to start tracking its performance. </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="fund in sortedFunds"
        :key="fund.id"
        class="cursor-pointer transition-colors hover:border-primary"
        @click="router.push('/investments/' + fund.id)"
      >
        <CardContent class="flex flex-col gap-2 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ChartCandlestick class="h-4 w-4 text-muted-foreground" />
              <strong>{{ fund.name }}</strong>
            </div>
            <Badge :variant="profitLoss(fund) >= 0 ? 'good' : 'over'">
              {{ profitLoss(fund) >= 0 ? '+' : '' }}{{ profitLossPercent(fund).toFixed(1) }}%
            </Badge>
          </div>
          <div class="text-xs text-muted-foreground">{{ fund.provider || 'No provider set' }}</div>
          <div class="amount text-lg font-semibold">{{ formatCurrency(currentValue(fund), settings.currencySymbol) }}</div>
          <div class="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>Invested {{ formatCurrency(totalInvested(fund), settings.currencySymbol) }}</span>
            <span :class="profitLoss(fund) >= 0 ? 'text-status-good' : 'text-status-over'">
              {{ profitLoss(fund) >= 0 ? '+' : '' }}{{ formatCurrency(profitLoss(fund), settings.currencySymbol) }}
            </span>
          </div>
          <div class="mt-1 flex gap-2" @click.stop>
            <Button variant="destructive" size="sm" @click="(e) => handleDelete(fund, e)">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <FundFormModal :open="modalOpen" :fund="null" @close="modalOpen = false" @save="handleSave" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
