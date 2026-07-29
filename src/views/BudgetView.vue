<script setup>
import { ref } from 'vue'
import { useBudget } from '../composables/useBudget.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Progress } from '@/components/ui/progress/index.js'
import { Switch } from '@/components/ui/switch/index.js'

const budget = useBudget()
const { settings, setOverallBudget, setCategoryBudget, setRollover } = useSettings()

const statusTextClass = { good: 'text-status-good', warn: 'text-status-warn', over: 'text-status-over' }

const editingOverall = ref(false)
const overallInput = ref(settings.overallBudget)

function saveOverall() {
  setOverallBudget(overallInput.value)
  editingOverall.value = false
}

const editingCategoryId = ref(null)
const categoryInput = ref('')

function startEditCategory(row) {
  editingCategoryId.value = row.category.id
  categoryInput.value = row.budget
}

function saveCategory(id) {
  setCategoryBudget(id, categoryInput.value)
  editingCategoryId.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card>
      <CardHeader class="flex-row items-start justify-between">
        <div>
          <CardTitle>Overall budget</CardTitle>
          <p class="mt-1 text-sm text-muted-foreground">
            This cycle: {{ formatCurrency(budget.cycleSpent.value, settings.currencySymbol) }} of
            {{ formatCurrency(settings.overallBudget, settings.currencySymbol) }}
          </p>
        </div>
        <Button
          v-if="!editingOverall"
          variant="outline"
          size="sm"
          @click="editingOverall = true; overallInput = settings.overallBudget"
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div v-if="editingOverall" class="flex gap-2">
          <Input v-model="overallInput" type="number" min="0" step="1" />
          <Button @click="saveOverall">Save</Button>
          <Button variant="ghost" @click="editingOverall = false">Cancel</Button>
        </div>

        <Progress :model-value="budget.overallPercentUsed.value" :status="budget.overallStatus.value" />

        <div class="flex justify-between text-sm text-muted-foreground">
          <span :class="statusTextClass[budget.overallStatus.value]">{{ budget.overallPercentUsed.value.toFixed(0) }}% used</span>
          <span>{{ formatCurrency(budget.overallRemaining.value, settings.currencySymbol) }} remaining</span>
        </div>

        <label class="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Switch :model-value="settings.rollover" @update:model-value="(v) => setRollover(v)" />
          Roll unused budget into next cycle
        </label>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Per-category budgets</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div
          v-for="row in budget.categoryBreakdown.value"
          :key="row.category.id"
          class="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-center sm:gap-3"
        >
          <div class="flex items-center gap-2">
            <span>{{ row.category.icon }}</span>
            <span class="text-sm font-medium">{{ row.category.name }}</span>
          </div>

          <Progress :model-value="row.percentUsed" :status="row.status" />

          <div class="amount flex flex-wrap items-center gap-2 whitespace-nowrap text-sm">
            <span :class="statusTextClass[row.status]">{{ formatCurrency(row.spent, settings.currencySymbol) }}</span>
            <span class="text-muted-foreground">/</span>
            <template v-if="editingCategoryId === row.category.id">
              <Input v-model="categoryInput" type="number" min="0" class="w-20" />
              <Button size="sm" @click="saveCategory(row.category.id)">Save</Button>
            </template>
            <template v-else>
              <span>{{ formatCurrency(row.budget, settings.currencySymbol) }}</span>
              <Button variant="ghost" size="sm" @click="startEditCategory(row)">Edit</Button>
            </template>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
