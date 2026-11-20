<script setup>
import { reactive, computed, watch } from 'vue'
import { toInputDate } from '../utils/date.js'
import { resolveSavedDate } from '../utils/reporting.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'
import { Switch } from '@/components/ui/switch/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  log: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  date: toInputDate(new Date()),
  odometer: '',
  liters: '',
  cost: '',
  fullTank: true,
  stationName: '',
  notes: '',
})

function resetForm() {
  form.date = toInputDate(new Date())
  form.odometer = ''
  form.liters = ''
  form.cost = ''
  form.fullTank = true
  form.stationName = ''
  form.notes = ''
}

watch(
  () => [props.open, props.log],
  () => {
    if (!props.open) return
    if (props.log) {
      form.date = toInputDate(props.log.date)
      form.odometer = props.log.odometer ?? ''
      form.liters = props.log.liters ?? ''
      form.cost = props.log.cost || ''
      form.fullTank = props.log.fullTank !== false
      form.stationName = props.log.stationName || ''
      form.notes = props.log.notes || ''
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const pricePerLiter = computed(() => {
  const liters = Number(form.liters)
  const cost = Number(form.cost)
  return liters > 0 && cost > 0 ? (cost / liters).toFixed(2) : ''
})

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!(Number(form.odometer) > 0)) {
    error.message = 'Odometer reading must be greater than 0'
    return
  }
  if (!(Number(form.liters) > 0)) {
    error.message = 'Liters must be greater than 0'
    return
  }
  emit('save', {
    date: resolveSavedDate(props.log?.date, form.date), // unchanged day keeps the stored value; a new/changed day is saved as local noon
    odometer: form.odometer,
    liters: form.liters,
    cost: form.cost,
    fullTank: form.fullTank,
    stationName: form.stationName,
    notes: form.notes,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ log ? 'Edit fuel entry' : 'Add fuel entry' }}</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Odometer reading</Label>
          <Input v-model="form.odometer" type="number" min="0" placeholder="e.g. 12450" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Liters</Label>
            <Input v-model="form.liters" type="number" min="0" step="0.01" placeholder="e.g. 6.5" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Cost (optional)</Label>
            <Input v-model="form.cost" type="number" min="0" step="0.01" placeholder="0.00" />
          </div>
        </div>
        <p v-if="pricePerLiter" class="m-0 text-xs text-muted-foreground">≈ {{ pricePerLiter }} / liter</p>
        <div class="flex items-center gap-2">
          <Switch v-model="form.fullTank" />
          <Label class="m-0">Filled to full tank</Label>
        </div>
        <p class="m-0 text-xs text-muted-foreground">Mileage (km/l) is only calculated between full-tank fill-ups.</p>
        <div class="flex flex-col gap-1.5">
          <Label>Station (optional)</Label>
          <Input v-model="form.stationName" type="text" />
        </div>
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
