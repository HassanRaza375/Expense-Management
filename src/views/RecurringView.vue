<script setup>
import { reactive, ref, computed } from 'vue'
import { Plus } from '@lucide/vue'
import { useRecurring } from '../composables/useRecurring.js'
import { useCategories } from '../composables/useCategories.js'
import { useSettings } from '../composables/useSettings.js'
import { toInputDate } from '../utils/date.js'
import { currentCycle } from '../utils/reporting.js'
import { toDateCycle, sanitizeResetDay } from '../utils/budgetMath.js'
import { formatCurrency } from '../utils/currency.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'

const { recurring, addTemplate, updateTemplate, togglePause, deleteTemplate, sortedByDueDate } = useRecurring()
const { sorted } = useCategories()
const { settings } = useSettings()

const cycle = computed(() => toDateCycle(currentCycle(new Date(), sanitizeResetDay(settings.cycleResetDay))))
const list = computed(() => sortedByDueDate(cycle.value).concat(recurring.filter((r) => !r.active)))

const modalOpen = ref(false)
const editingId = ref(null)

const form = reactive({
  name: '',
  categoryId: '',
  amountMode: 'fixed',
  amount: '',
  dueDay: 1,
  leadDays: 0,
  endDate: '',
})

function resetForm() {
  form.name = ''
  form.categoryId = sorted()[0]?.id || ''
  form.amountMode = 'fixed'
  form.amount = ''
  form.dueDay = 1
  form.leadDays = 0
  form.endDate = ''
}

function openAdd() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

function openEdit(tpl) {
  editingId.value = tpl.id
  form.name = tpl.name
  form.categoryId = tpl.categoryId
  form.amountMode = tpl.amountMode
  form.amount = tpl.amount || ''
  form.dueDay = tpl.dueDay
  form.leadDays = tpl.leadDays
  form.endDate = tpl.endDate ? toInputDate(tpl.endDate) : ''
  modalOpen.value = true
}

function submit() {
  const payload = {
    name: form.name,
    categoryId: form.categoryId,
    amountMode: form.amountMode,
    amount: form.amount,
    dueDay: form.dueDay,
    leadDays: form.leadDays,
    endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
  }
  if (editingId.value) {
    updateTemplate(editingId.value, {
      ...payload,
      amount: payload.amountMode === 'fixed' ? Number(payload.amount) || 0 : null,
    })
  } else {
    addTemplate(payload)
  }
  modalOpen.value = false
}

function categoryFor(id) {
  return sorted().find((c) => c.id === id) || {}
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-display text-xl">Recurring templates</h2>
      <Button @click="openAdd"><Plus class="h-4 w-4" /> Add recurring</Button>
    </div>

    <Card v-if="!list.length">
      <CardContent class="p-8 text-center text-muted-foreground">
        No recurring expenses yet. Add rent, gym, or bills to get reminded each cycle.
      </CardContent>
    </Card>

    <div class="flex flex-col gap-2">
      <Card v-for="tpl in list" :key="tpl.id" :class="!tpl.active && 'opacity-55'">
        <CardContent class="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div class="font-medium">{{ categoryFor(tpl.categoryId).icon }} {{ tpl.name }}</div>
            <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {{ tpl.amountMode === 'fixed' ? formatCurrency(tpl.amount, settings.currencySymbol) : 'Variable' }}
              · due day {{ tpl.dueDay }} · lead {{ tpl.leadDays }}d
              <Badge v-if="!tpl.active" variant="secondary">paused</Badge>
              <Badge v-if="tpl.endDate" variant="secondary">ends {{ new Date(tpl.endDate).toLocaleDateString() }}</Badge>
            </div>
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="openEdit(tpl)">Edit</Button>
            <Button variant="outline" size="sm" @click="togglePause(tpl.id)">{{ tpl.active ? 'Pause' : 'Resume' }}</Button>
            <Button variant="destructive" size="sm" @click="deleteTemplate(tpl.id)">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog :open="modalOpen" @update:open="(v) => !v && (modalOpen = false)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? 'Edit recurring' : 'Add recurring' }}</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input v-model="form.name" type="text" placeholder="Rent, Gym, Electricity..." />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select v-model="form.categoryId">
              <SelectTrigger><SelectValue>{{ categoryFor(form.categoryId).icon }} {{ categoryFor(form.categoryId).name }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="cat in sorted()" :key="cat.id" :value="cat.id">{{ cat.icon }} {{ cat.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Amount mode</Label>
            <Select v-model="form.amountMode">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="variable">Variable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="form.amountMode === 'fixed'" class="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input v-model="form.amount" type="number" min="0" step="0.01" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Due day (1–31)</Label>
            <Input v-model="form.dueDay" type="number" min="1" max="31" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Lead days (prompt this many days early)</Label>
            <Input v-model="form.leadDays" type="number" min="0" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>End date (optional)</Label>
            <Input v-model="form.endDate" type="date" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" @click="modalOpen = false">Cancel</Button>
          <Button @click="submit">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
