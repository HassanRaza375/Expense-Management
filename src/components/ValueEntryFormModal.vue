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
  entry: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  date: toInputDate(new Date()),
  value: '',
  notes: '',
})

function resetForm() {
  form.date = toInputDate(new Date())
  form.value = ''
  form.notes = ''
}

watch(
  () => [props.open, props.entry],
  () => {
    if (!props.open) return
    if (props.entry) {
      form.date = toInputDate(props.entry.date)
      form.value = props.entry.value
      form.notes = props.entry.notes || ''
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!(Number(form.value) >= 0)) {
    error.message = 'Value must be 0 or greater'
    return
  }
  emit('save', {
    date: new Date(form.date).toISOString(),
    value: form.value,
    notes: form.notes,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ entry ? 'Edit value update' : 'Add value update' }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Current value</Label>
          <Input v-model="form.value" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>
      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ entry ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
