<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { useBills, useConnections, METERED_BILL_TYPES, BILL_STATUSES } from '../composables/useBills.js'
import { toInputDate } from '../utils/date.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import BillAttachments from './BillAttachments.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  bill: { type: Object, default: null },
})

const emit = defineEmits(['close', 'saved'])

const { addBill, updateBill, getPreviousReading } = useBills()
const { connections, findConnection } = useConnections()

const NON_PAID_STATUSES = BILL_STATUSES.filter((s) => s.value !== 'paid')

const form = reactive({
  connectionId: '',
  billingMonth: '',
  providerBillNumber: '',
  status: 'unpaid',
  issueDate: '',
  dueDate: '',
  amount: '',
  arrears: '',
  currentReading: '',
  meterNumber: '',
  notes: '',
})

const savedBill = ref(null)
const stepIndex = ref(0)
const error = ref('')

const selectedConnection = computed(() => findConnection(form.connectionId))
const isMetered = computed(() => METERED_BILL_TYPES.includes(selectedConnection.value?.billType))

const steps = computed(() => {
  const base = ['connection', 'details']
  if (isMetered.value) base.push('meter')
  base.push('review')
  return base
})

const currentStep = computed(() => steps.value[stepIndex.value])

const previousReadingPreview = computed(() => {
  if (savedBill.value) return savedBill.value.previousReading
  return form.connectionId ? getPreviousReading(form.connectionId) : null
})

const unitsUsedPreview = computed(() => {
  const prev = previousReadingPreview.value
  const curr = form.currentReading
  if (prev == null || curr === '' || curr == null) return null
  const diff = Number(curr) - Number(prev)
  return Number.isFinite(diff) ? diff : null
})

function resetForm() {
  form.connectionId = connections[0]?.id || ''
  form.billingMonth = ''
  form.providerBillNumber = ''
  form.status = 'unpaid'
  form.issueDate = ''
  form.dueDate = ''
  form.amount = ''
  form.arrears = ''
  form.currentReading = ''
  form.meterNumber = ''
  form.notes = ''
  savedBill.value = null
  stepIndex.value = 0
  error.value = ''
}

watch(
  () => [props.open, props.bill],
  () => {
    if (!props.open) return
    error.value = ''
    stepIndex.value = 0
    if (props.bill) {
      Object.assign(form, {
        connectionId: props.bill.connectionId,
        billingMonth: props.bill.billingMonth,
        providerBillNumber: props.bill.providerBillNumber,
        status: props.bill.status,
        issueDate: props.bill.issueDate ? toInputDate(props.bill.issueDate) : '',
        dueDate: toInputDate(props.bill.dueDate),
        amount: props.bill.amount,
        arrears: props.bill.arrears,
        currentReading: props.bill.currentReading ?? '',
        meterNumber: props.bill.meterNumber,
        notes: props.bill.notes,
      })
      savedBill.value = props.bill
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

function goNext() {
  error.value = ''
  if (currentStep.value === 'connection' && (!form.connectionId || !form.billingMonth)) {
    error.value = 'Connection and billing month are required'
    return
  }
  if (currentStep.value === 'details' && (!form.dueDate || !(Number(form.amount) >= 0))) {
    error.value = 'Due date and a valid amount are required'
    return
  }
  stepIndex.value++
}

function goBack() {
  error.value = ''
  stepIndex.value--
}

function save() {
  error.value = ''
  try {
    if (savedBill.value) {
      updateBill(savedBill.value.id, { ...form })
      savedBill.value = { ...savedBill.value, ...form }
    } else {
      savedBill.value = addBill({ ...form })
    }
    emit('saved')
  } catch (e) {
    error.value = e.message
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && close()">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ bill ? 'Edit bill' : 'Add bill' }}</DialogTitle>
      </DialogHeader>

      <div class="flex items-center gap-1 text-xs text-muted-foreground">
        <span v-for="(s, idx) in steps" :key="s" class="flex items-center gap-1">
          <span :class="idx === stepIndex ? 'font-semibold text-primary' : ''">{{ idx + 1 }}. {{ s }}</span>
          <span v-if="idx < steps.length - 1">→</span>
        </span>
      </div>

      <div v-if="currentStep === 'connection'" class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Connection</Label>
          <Select v-model="form.connectionId">
            <SelectTrigger><SelectValue>{{ selectedConnection?.connectionName || 'Choose a connection' }}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="c in connections" :key="c.id" :value="c.id">{{ c.connectionName }} ({{ c.provider }})</SelectItem>
            </SelectContent>
          </Select>
          <p v-if="!connections.length" class="text-xs text-muted-foreground">No connections yet — add one from the Connections tab first.</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Billing month</Label>
          <Input v-model="form.billingMonth" type="month" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Provider bill number (optional)</Label>
          <Input v-model="form.providerBillNumber" type="text" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select v-model="form.status">
            <SelectTrigger><SelectValue>{{ NON_PAID_STATUSES.find((s) => s.value === form.status)?.label }}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="s in NON_PAID_STATUSES" :key="s.value" :value="s.value">{{ s.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div v-else-if="currentStep === 'details'" class="flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Issue date</Label>
            <Input v-model="form.issueDate" type="date" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Due date</Label>
            <Input v-model="form.dueDate" type="date" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input v-model="form.amount" type="number" min="0" step="0.01" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Arrears (optional)</Label>
            <Input v-model="form.arrears" type="number" min="0" step="0.01" />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>

      <div v-else-if="currentStep === 'meter'" class="flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Previous reading</Label>
            <div class="flex h-9 items-center rounded-md border border-input bg-secondary px-3 text-sm text-muted-foreground">
              {{ previousReadingPreview ?? 'None yet' }}
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Current reading</Label>
            <Input v-model="form.currentReading" type="number" step="0.01" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Meter number</Label>
            <Input v-model="form.meterNumber" type="text" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Units used</Label>
            <div class="flex h-9 items-center rounded-md border border-input bg-secondary px-3 text-sm text-muted-foreground">
              {{ unitsUsedPreview ?? '—' }}
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="currentStep === 'review'" class="flex flex-col gap-4">
        <div v-if="!savedBill" class="flex flex-col gap-1 text-sm">
          <div><span class="text-muted-foreground">Connection:</span> {{ selectedConnection?.connectionName }}</div>
          <div><span class="text-muted-foreground">Billing month:</span> {{ form.billingMonth }}</div>
          <div><span class="text-muted-foreground">Due date:</span> {{ form.dueDate }}</div>
          <div><span class="text-muted-foreground">Amount:</span> {{ form.amount }} (+{{ form.arrears || 0 }} arrears)</div>
          <Button class="mt-2" @click="save">Save bill</Button>
        </div>
        <div v-else class="flex flex-col gap-3">
          <p class="text-sm text-status-good">Bill saved. Attach documents (optional):</p>
          <BillAttachments :bill="savedBill" />
        </div>
      </div>

      <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>

      <DialogFooter class="justify-between sm:justify-between">
        <div class="flex gap-2">
          <Button v-if="stepIndex > 0 && currentStep !== 'review'" variant="ghost" @click="goBack">Back</Button>
        </div>
        <div class="flex gap-2">
          <Button variant="ghost" @click="close">{{ savedBill ? 'Done' : 'Cancel' }}</Button>
          <Button v-if="currentStep !== 'review'" @click="goNext">Next</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
