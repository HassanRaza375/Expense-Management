<script setup>
import { reactive, watch } from 'vue'
import { VEHICLE_TYPES, FUEL_TYPES } from '../composables/useVehicles.js'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  vehicle: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  name: '',
  type: 'bike',
  make: '',
  model: '',
  year: '',
  registrationNumber: '',
  purchaseDate: '',
  currentOdometer: '',
  fuelType: 'petrol',
  notes: '',
})

function resetForm() {
  form.name = ''
  form.type = 'bike'
  form.make = ''
  form.model = ''
  form.year = ''
  form.registrationNumber = ''
  form.purchaseDate = ''
  form.currentOdometer = ''
  form.fuelType = 'petrol'
  form.notes = ''
}

watch(
  () => [props.open, props.vehicle],
  () => {
    if (!props.open) return
    if (props.vehicle) {
      Object.assign(form, props.vehicle)
      form.purchaseDate = props.vehicle.purchaseDate ? toInputDate(props.vehicle.purchaseDate) : ''
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!form.name || !form.name.trim()) {
    error.message = 'Name is required'
    return
  }
  emit('save', { ...form })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ vehicle ? 'Edit vehicle' : 'Add vehicle' }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5"><Label>Name</Label><Input v-model="form.name" type="text" placeholder="e.g. Honda CD 70" /></div>
        <div class="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select v-model="form.type">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in VEHICLE_TYPES" :key="t" :value="t">{{ t }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5"><Label>Make</Label><Input v-model="form.make" type="text" /></div>
          <div class="flex flex-col gap-1.5"><Label>Model</Label><Input v-model="form.model" type="text" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5"><Label>Year</Label><Input v-model="form.year" type="text" /></div>
          <div class="flex flex-col gap-1.5"><Label>Registration #</Label><Input v-model="form.registrationNumber" type="text" /></div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Fuel type</Label>
          <Select v-model="form.fuelType">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="f in FUEL_TYPES" :key="f" :value="f">{{ f }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-1.5"><Label>Current odometer (km)</Label><Input v-model="form.currentOdometer" type="number" min="0" /></div>
        <div class="flex flex-col gap-1.5"><Label>Purchase date</Label><Input v-model="form.purchaseDate" type="date" /></div>
        <div class="flex flex-col gap-1.5"><Label>Notes</Label><Textarea v-model="form.notes" rows="2" /></div>
      </div>
      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
