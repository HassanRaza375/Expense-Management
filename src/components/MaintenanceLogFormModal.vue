<script setup>
import { reactive, computed, watch } from 'vue'
import { LOG_TYPES, LOG_TYPE_LABELS } from '../composables/useVehicleMaintenance.js'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  log: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  type: 'odometer',
  date: toInputDate(new Date()),
  odometer: '',
  cost: '',
  title: '',
  vendor: '',
  nextDueOdometer: '',
  nextDueDate: '',
  notes: '',
})

function resetForm() {
  form.type = 'odometer'
  form.date = toInputDate(new Date())
  form.odometer = ''
  form.cost = ''
  form.title = ''
  form.vendor = ''
  form.nextDueOdometer = ''
  form.nextDueDate = ''
  form.notes = ''
}

watch(
  () => [props.open, props.log],
  () => {
    if (!props.open) return
    if (props.log) {
      form.type = props.log.type
      form.date = toInputDate(props.log.date)
      form.odometer = props.log.odometer ?? ''
      form.cost = props.log.cost || ''
      form.title = props.log.title || ''
      form.vendor = props.log.vendor || ''
      form.nextDueOdometer = props.log.nextDueOdometer ?? ''
      form.nextDueDate = props.log.nextDueDate ? toInputDate(props.log.nextDueDate) : ''
      form.notes = props.log.notes || ''
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const showCostFields = computed(() => form.type !== 'odometer')
const showDueFields = computed(() => form.type === 'oil_change' || form.type === 'service')

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (form.type === 'odometer' && !(Number(form.odometer) > 0)) {
    error.message = 'Odometer reading must be greater than 0'
    return
  }
  emit('save', {
    type: form.type,
    date: new Date(form.date).toISOString(),
    odometer: form.odometer,
    cost: form.cost,
    title: form.title,
    vendor: form.vendor,
    nextDueOdometer: form.nextDueOdometer,
    nextDueDate: form.nextDueDate ? new Date(form.nextDueDate).toISOString() : '',
    notes: form.notes,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ log ? 'Edit log entry' : 'Add log entry' }}</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select v-model="form.type">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in LOG_TYPES" :key="t" :value="t">{{ LOG_TYPE_LABELS[t] }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Odometer reading (optional)</Label>
          <Input v-model="form.odometer" type="number" min="0" placeholder="e.g. 12450" />
        </div>

        <template v-if="showCostFields">
          <div class="flex flex-col gap-1.5">
            <Label>{{ LOG_TYPE_LABELS[form.type] }} — description</Label>
            <Input v-model="form.title" type="text" placeholder="e.g. Engine oil + filter" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Cost (optional)</Label>
            <Input v-model="form.cost" type="number" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Shop / mechanic (optional)</Label>
            <Input v-model="form.vendor" type="text" />
          </div>
        </template>

        <template v-if="showDueFields">
          <div class="flex flex-col gap-1.5">
            <Label>Next due — odometer (optional)</Label>
            <Input v-model="form.nextDueOdometer" type="number" min="0" placeholder="e.g. 13000" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Next due — date (optional)</Label>
            <Input v-model="form.nextDueDate" type="date" />
          </div>
        </template>

        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>

      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>

      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ log ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
