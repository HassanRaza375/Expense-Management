<script setup>
import { reactive, watch } from 'vue'
import { useCategories } from '../composables/useCategories.js'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  expense: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const { sorted } = useCategories()

const form = reactive({
  date: toInputDate(new Date()),
  amount: '',
  categoryId: '',
  note: '',
})

watch(
  () => [props.open, props.expense],
  () => {
    if (!props.open) return
    if (props.expense) {
      form.date = toInputDate(props.expense.date)
      form.amount = props.expense.amount
      form.categoryId = props.expense.categoryId
      form.note = props.expense.note || ''
    } else {
      form.date = toInputDate(new Date())
      form.amount = ''
      form.categoryId = sorted()[0]?.id || ''
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
  if (!form.categoryId) {
    error.message = 'Category is required'
    return
  }
  emit('save', {
    date: new Date(form.date).toISOString(),
    amount: amt,
    categoryId: form.categoryId,
    note: form.note,
  })
}

function categoryLabel(id) {
  const cat = sorted().find((c) => c.id === id)
  return cat ? `${cat.icon} ${cat.name}` : ''
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ expense ? 'Edit expense' : 'Add expense' }}</DialogTitle>
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
          <Label>Category</Label>
          <Select v-model="form.categoryId">
            <SelectTrigger>
              <SelectValue placeholder="Choose a category">{{ categoryLabel(form.categoryId) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cat in sorted()" :key="cat.id" :value="cat.id">{{ cat.icon }} {{ cat.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Note (optional)</Label>
          <Input v-model="form.note" type="text" placeholder="What was this for?" />
        </div>
      </div>

      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>

      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ expense ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
