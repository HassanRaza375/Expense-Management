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
  reading: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  date: toInputDate(new Date()),
  reading: '',
  notes: '',
})

function resetForm() {
  form.date = toInputDate(new Date())
  form.reading = ''
  form.notes = ''
}

watch(
  () => [props.open, props.reading],
  () => {
    if (!props.open) return
    if (props.reading) {
      form.date = toInputDate(props.reading.date)
      form.reading = props.reading.reading
      form.notes = props.reading.notes || ''
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!(Number(form.reading) >= 0)) {
    error.message = 'Reading must be 0 or greater'
    return
  }
  emit('save', {
    date: new Date(form.date).toISOString(),
    reading: form.reading,
    notes: form.notes,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ reading ? 'Edit reading' : 'Add reading' }}</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Meter reading</Label>
          <Input v-model="form.reading" type="number" min="0" step="0.01" placeholder="e.g. 12450" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>

      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>

      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ reading ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
