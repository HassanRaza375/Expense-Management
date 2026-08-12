<script setup>
import { reactive, watch } from 'vue'
import { INCOME_SOURCES, INCOME_SOURCE_LABELS } from '../composables/useIncome.js'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  income: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  date: toInputDate(new Date()),
  amount: '',
  sourceType: 'salary',
  note: '',
})

watch(
  () => [props.open, props.income],
  () => {
    if (!props.open) return
    if (props.income) {
      form.date = toInputDate(props.income.date)
      form.amount = props.income.amount
      form.sourceType = props.income.sourceType
      form.note = props.income.note || ''
    } else {
      form.date = toInputDate(new Date())
      form.amount = ''
      form.sourceType = 'salary'
      form.note = ''
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  const amt = Number(form.amount)
  if (!(amt > 0)) {
    error.message = 'Amount must be greater than 0'
    return
  }
  emit('save', {
    date: new Date(form.date).toISOString(),
    amount: amt,
    sourceType: form.sourceType,
    note: form.note,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ income ? 'Edit income' : 'Add income' }}</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Amount</Label>
          <Input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Source</Label>
          <Select v-model="form.sourceType">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="s in INCOME_SOURCES" :key="s" :value="s">{{ INCOME_SOURCE_LABELS[s] }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Note (optional)</Label>
          <Input v-model="form.note" type="text" placeholder="e.g. August salary" />
        </div>
      </div>

      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>

      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ income ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
