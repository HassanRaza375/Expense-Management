<script setup>
import { reactive, computed, watch } from 'vue'
import { useVehicleTags } from '../composables/useVehicleTags.js'
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

const { tags, findById: findTag } = useVehicleTags()

const NO_TAG_VALUE = '__none__'

const form = reactive({
  tagValue: NO_TAG_VALUE,
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
  form.tagValue = NO_TAG_VALUE
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
      form.tagValue = props.log.tagId || NO_TAG_VALUE
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

const selectedTag = computed(() => (form.tagValue !== NO_TAG_VALUE ? findTag(form.tagValue) : null))
const showTaggedFields = computed(() => !!selectedTag.value)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!showTaggedFields.value && !(Number(form.odometer) > 0)) {
    error.message = 'Odometer reading must be greater than 0'
    return
  }
  emit('save', {
    tagId: form.tagValue !== NO_TAG_VALUE ? form.tagValue : null,
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
          <Label>Tag</Label>
          <Select v-model="form.tagValue">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_TAG_VALUE">No tag (odometer reading only)</SelectItem>
              <SelectItem v-for="t in tags" :key="t.id" :value="t.id">{{ t.icon }} {{ t.name }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="m-0 text-xs text-muted-foreground">Manage tags from the Vehicles page.</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Odometer reading (optional)</Label>
          <Input v-model="form.odometer" type="number" min="0" placeholder="e.g. 12450" />
        </div>

        <template v-if="showTaggedFields">
          <div class="flex flex-col gap-1.5">
            <Label>{{ selectedTag.name }} — description</Label>
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
