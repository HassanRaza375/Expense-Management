<script setup>
import { reactive, watch } from 'vue'
import { toInputDate } from '../utils/date.js'
import { resolveSavedDate } from '../utils/reporting.js'
import { useSettings } from '../composables/useSettings.js'
import { useAccounts } from '../composables/useAccounts.js'
import { initialAccountId } from '../utils/accountsView.js'
import AccountPicker from './AccountPicker.vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  maxAmount: { type: Number, default: 0 },
  defaultAccountId: { type: String, default: '' }, // the loan's own account: a repayment usually goes back to / from it
})

const emit = defineEmits(['close', 'save'])

const { settings, setLastAccountId } = useSettings()
const { store: accountStore } = useAccounts()

const form = reactive({
  date: toInputDate(new Date()),
  amount: '',
  accountId: '',
  notes: '',
})

watch(
  () => props.open,
  () => {
    if (!props.open) return
    form.date = toInputDate(new Date())
    form.amount = ''
    form.accountId = initialAccountId(accountStore, { mode: 'create', lastAccountId: props.defaultAccountId || settings.lastAccountId, defaultAccountId: settings.defaultAccountId })
    form.notes = ''
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function fillRemaining() {
  form.amount = props.maxAmount
}

function submit() {
  error.message = ''
  const amt = Number(form.amount)
  if (!(amt > 0)) {
    error.message = 'Amount must be greater than 0'
    return
  }
  if (amt > props.maxAmount) {
    error.message = `Cannot exceed remaining balance`
    return
  }
  const payload = {
    date: resolveSavedDate(undefined, form.date), // repayments are only ever created: saved as local noon of the chosen day
    amount: amt,
    notes: form.notes,
  }
  if (accountStore.accounts.length) {
    payload.accountId = form.accountId
    setLastAccountId(form.accountId)
  }
  emit('save', payload)
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add repayment</DialogTitle>
        <DialogDescription class="sr-only">Enter the repayment amount and the date, then save.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <Label>Amount</Label>
            <button type="button" class="text-xs text-primary underline" @click="fillRemaining">Fill remaining</button>
          </div>
          <Input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <AccountPicker v-model="form.accountId" />
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
