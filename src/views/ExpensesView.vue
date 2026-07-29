<script setup>
import { ref, computed } from 'vue'
import { Plus, Pencil, Copy, Trash2, Search } from '@lucide/vue'
import { useExpenses } from '../composables/useExpenses.js'
import { useCategories } from '../composables/useCategories.js'
import { useSettings } from '../composables/useSettings.js'
import { getCycle, getAdjacentCycle, isWithinCycle, formatDate } from '../utils/date.js'
import { formatCurrency } from '../utils/currency.js'
import ExpenseFormModal from '../components/ExpenseFormModal.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Checkbox } from '@/components/ui/checkbox/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const { expenses, addExpense, updateExpense, deleteExpense, undoDelete, duplicateExpense, deleteMany, groupedByDay } = useExpenses()
const { sorted, findById: findCategory } = useCategories()
const { settings } = useSettings()

const filterCategory = ref('all')
const filterCycleMode = ref('this') // this | last | custom | all
const customStart = ref('')
const customEnd = ref('')
const searchText = ref('')

const modalOpen = ref(false)
const editingExpense = ref(null)

const selectedIds = ref(new Set())

const currentCycle = computed(() => getCycle(new Date(), settings.cycleResetDay))
const lastCycle = computed(() => getAdjacentCycle(currentCycle.value.start, settings.cycleResetDay, -1))

const activeCycle = computed(() => {
  if (filterCycleMode.value === 'this') return currentCycle.value
  if (filterCycleMode.value === 'last') return lastCycle.value
  if (filterCycleMode.value === 'custom' && customStart.value && customEnd.value) {
    return { start: new Date(customStart.value), end: new Date(customEnd.value) }
  }
  return null
})

const filtered = computed(() => {
  let list = expenses
  if (activeCycle.value) {
    list = list.filter((e) => isWithinCycle(e.date, activeCycle.value))
  }
  if (filterCategory.value !== 'all') {
    list = list.filter((e) => e.categoryId === filterCategory.value)
  }
  if (searchText.value.trim()) {
    const q = searchText.value.trim().toLowerCase()
    list = list.filter((e) => (e.note || '').toLowerCase().includes(q))
  }
  return list
})

const groups = computed(() => groupedByDay(filtered.value))

function categoryFor(id) {
  return findCategory(id) || { name: 'Deleted', icon: '❓', color: '#8FA0AC' }
}

function openAdd() {
  editingExpense.value = null
  modalOpen.value = true
}

function openEdit(exp) {
  editingExpense.value = exp
  modalOpen.value = true
}

function handleSave(payload) {
  if (editingExpense.value) {
    updateExpense(editingExpense.value.id, payload)
  } else {
    addExpense(payload)
  }
  modalOpen.value = false
}

function handleDelete(id) {
  deleteExpense(id)
  toast('Expense deleted', {
    action: {
      label: 'Undo',
      onClick: () => undoDelete(),
    },
  })
}

function toggleSelect(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function bulkDelete() {
  deleteMany([...selectedIds.value])
  selectedIds.value = new Set()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card>
      <CardContent class="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Select v-model="filterCycleMode">
            <SelectTrigger class="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this">This cycle</SelectItem>
              <SelectItem value="last">Last cycle</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <template v-if="filterCycleMode === 'custom'">
            <Input v-model="customStart" type="date" class="w-full sm:w-40" />
            <Input v-model="customEnd" type="date" class="w-full sm:w-40" />
          </template>
          <Select v-model="filterCategory">
            <SelectTrigger class="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem v-for="cat in sorted()" :key="cat.id" :value="cat.id">{{ cat.icon }} {{ cat.name }}</SelectItem>
            </SelectContent>
          </Select>
          <div class="relative">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="searchText" type="text" placeholder="Search notes..." class="w-full pl-8 sm:w-48" />
          </div>
        </div>
        <Button class="w-full sm:w-auto" @click="openAdd"><Plus class="h-4 w-4" /> Add expense</Button>
      </CardContent>
    </Card>

    <Card v-if="selectedIds.size">
      <CardContent class="flex items-center justify-between p-3">
        <span class="text-sm">{{ selectedIds.size }} selected</span>
        <Button variant="destructive" size="sm" @click="bulkDelete"><Trash2 class="h-4 w-4" /> Delete selected</Button>
      </CardContent>
    </Card>

    <Card v-if="!groups.length">
      <CardContent class="p-8 text-center text-muted-foreground">No expenses match these filters.</CardContent>
    </Card>

    <div v-for="group in groups" :key="group.day" class="flex flex-col gap-2">
      <div class="flex justify-between px-1 text-sm text-muted-foreground">
        <span>{{ formatDate(group.day, 'long') }}</span>
        <span class="amount">{{ formatCurrency(group.total, settings.currencySymbol) }}</span>
      </div>
      <Card class="overflow-hidden py-0">
        <div v-for="exp in group.items" :key="exp.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <Checkbox :model-value="selectedIds.has(exp.id)" @update:model-value="toggleSelect(exp.id)" />
          <span class="text-lg">{{ categoryFor(exp.categoryId).icon }}</span>
          <div class="min-w-0 flex-1 basis-32">
            <div class="truncate font-medium">{{ exp.note || categoryFor(exp.categoryId).name }}</div>
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              {{ categoryFor(exp.categoryId).name }}
              <Badge v-if="exp.source === 'recurring'" variant="secondary">recurring</Badge>
              <Badge v-if="exp.source === 'bill'" variant="secondary">bill</Badge>
            </div>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <div class="amount font-semibold whitespace-nowrap">{{ formatCurrency(exp.amount, settings.currencySymbol) }}</div>
            <div class="flex gap-1">
              <Button variant="ghost" size="icon" title="Edit" @click="openEdit(exp)"><Pencil class="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Duplicate" @click="duplicateExpense(exp.id)"><Copy class="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Delete" @click="handleDelete(exp.id)"><Trash2 class="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <ExpenseFormModal :open="modalOpen" :expense="editingExpense" @close="modalOpen = false" @save="handleSave" />
  </div>
</template>
