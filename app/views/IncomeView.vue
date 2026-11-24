<script setup>
import { ref, computed } from 'vue'
import { Plus, Pencil, Trash2 } from '@lucide/vue'
import { useIncome, INCOME_SOURCE_LABELS } from '../composables/useIncome.js'
import { useSettings } from '../composables/useSettings.js'
import { useAccounts } from '../composables/useAccounts.js'
import { incomeOverview, sanitizeResetDay } from '../utils/budgetMath.js'
import { formatDayKey } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import IncomeFormModal from '../components/IncomeFormModal.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const { income, addIncome, updateIncome, deleteIncome, undoDelete } = useIncome()
const { settings } = useSettings()
const { findAccount } = useAccounts()
const accountLabel = (inc) => (inc?.accountId ? findAccount(inc.accountId)?.name || '' : '')

const filterCycleMode = ref('this') // this | last | all

const modalOpen = ref(false)
const editingIncome = ref(null)

// Filtering, grouping by LOCAL day and the total all come from utils/budgetMath.js + reporting.js (the same cycle logic
// as the Dashboard, Budget and Expenses pages). The page itself does no date math.
const overview = computed(() => incomeOverview(income, { mode: filterCycleMode.value, now: new Date(), resetDay: sanitizeResetDay(settings.cycleResetDay) }))
const groups = computed(() => overview.value.groups)
const total = computed(() => overview.value.total)

function openAdd() {
  editingIncome.value = null
  modalOpen.value = true
}

function openEdit(inc) {
  editingIncome.value = inc
  modalOpen.value = true
}

function handleSave(payload) {
  if (editingIncome.value) {
    updateIncome(editingIncome.value.id, payload)
  } else {
    addIncome(payload)
  }
  modalOpen.value = false
}

function handleDelete(id) {
  deleteIncome(id)
  toast('Income deleted', {
    action: { label: 'Undo', onClick: () => undoDelete() },
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card>
      <CardContent class="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select v-model="filterCycleMode">
            <SelectTrigger class="w-full sm:w-40" aria-label="Budget cycle"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this">This cycle</SelectItem>
              <SelectItem value="last">Last cycle</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <span class="text-sm text-muted-foreground" data-testid="income-total">Total: {{ formatCurrency(total, settings.currencySymbol) }}</span>
        </div>
        <Button class="w-full sm:w-auto" @click="openAdd"><Plus class="h-4 w-4" /> Add income</Button>
      </CardContent>
    </Card>

    <Card v-if="!groups.length">
      <CardContent class="p-8 text-center text-muted-foreground">No income recorded for this period.</CardContent>
    </Card>

    <div v-for="group in groups" :key="group.dayKey ?? 'unknown'" class="flex flex-col gap-2" data-testid="income-day">
      <div class="flex justify-between px-1 text-sm text-muted-foreground">
        <span>{{ group.dayKey ? formatDayKey(group.dayKey, { weekday: true }) : 'Date unreadable' }}</span>
        <span class="amount">{{ formatCurrency(group.net, settings.currencySymbol) }}</span>
      </div>
      <Card class="overflow-hidden py-0">
        <div v-for="inc in group.items" :key="inc.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1 basis-32">
            <div class="truncate font-medium">{{ inc.note || INCOME_SOURCE_LABELS[inc.sourceType] }}</div>
            <div class="text-xs text-muted-foreground">
              {{ INCOME_SOURCE_LABELS[inc.sourceType] }}<span v-if="accountLabel(inc)" data-testid="income-account"> · {{ accountLabel(inc) }}</span>
            </div>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <div class="amount font-semibold whitespace-nowrap text-status-good">{{ formatCurrency(inc.amount, settings.currencySymbol) }}</div>
            <div class="flex gap-1">
              <Button variant="ghost" size="icon" title="Edit" @click="openEdit(inc)"><Pencil class="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Delete" @click="handleDelete(inc.id)"><Trash2 class="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <IncomeFormModal :open="modalOpen" :income="editingIncome" @close="modalOpen = false" @save="handleSave" />
  </div>
</template>
