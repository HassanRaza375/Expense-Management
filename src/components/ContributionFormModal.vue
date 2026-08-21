<script setup>
import { reactive, watch } from 'vue'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  date: toInputDate(new Date()),
  amount: '',
  notes: '',
})

watch(
  () => props.open,
  () => {
    if (!props.open) return
    form.date = toInputDate(new Date())
    form.amount = ''
    form.notes = ''
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!(Number(form.amount) > 0)) {
    error.message = 'Amount must be greater than 0'
    return
  }
  emit('save', {
    date: new Date(form.date).toISOString(),
    amount: form.amount,
    notes: form.notes,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add contribution</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Amount invested</Label>
          <Input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>
      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">Add</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
