<script setup>
import { reactive, computed, watch } from 'vue'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  loan: { type: Object, default: null }, // null = create mode
  direction: { type: String, default: 'lent' }, // 'lent' | 'borrowed' — only used when creating
})

const emit = defineEmits(['close', 'save'])

const activeDirection = computed(() => props.loan?.direction || props.direction)
const isBorrowed = computed(() => activeDirection.value === 'borrowed')

const form = reactive({
  personName: '',
  amount: '',
  date: toInputDate(new Date()),
  dueDate: '',
  notes: '',
})

function resetForm() {
  form.personName = ''
  form.amount = ''
  form.date = toInputDate(new Date())
  form.dueDate = ''
  form.notes = ''
}

watch(
  () => [props.open, props.loan],
  () => {
    if (!props.open) return
    if (props.loan) {
      form.personName = props.loan.personName ?? props.loan.borrowerName ?? ''
      form.amount = props.loan.amount
      form.date = toInputDate(props.loan.date)
      form.dueDate = props.loan.dueDate ? toInputDate(props.loan.dueDate) : ''
      form.notes = props.loan.notes || ''
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!form.personName.trim()) {
    error.message = 'Name is required'
    return
  }
  if (!(Number(form.amount) > 0)) {
    error.message = 'Amount must be greater than 0'
    return
  }
  emit('save', {
    direction: activeDirection.value,
    personName: form.personName,
    amount: form.amount,
    date: new Date(form.date).toISOString(),
    dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : '',
    notes: form.notes,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {{ loan ? 'Edit ' : 'Add ' }}{{ isBorrowed ? 'borrowing' : 'loan' }}
        </DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>{{ isBorrowed ? 'Lender name' : 'Borrower name' }}</Label>
          <Input v-model="form.personName" type="text" :placeholder="isBorrowed ? 'e.g. Sara' : 'e.g. Ahmed'" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>{{ isBorrowed ? 'Amount borrowed' : 'Amount given' }}</Label>
          <Input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>{{ isBorrowed ? 'Date borrowed' : 'Date given' }}</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Due date (optional)</Label>
          <Input v-model="form.dueDate" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>

      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>

      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ loan ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
