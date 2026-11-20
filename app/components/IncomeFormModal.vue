<script setup>
import { reactive, watch } from 'vue'
import { INCOME_SOURCES, INCOME_SOURCE_LABELS } from '../composables/useIncome.js'
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
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  income: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const { settings, setLastAccountId } = useSettings()
const { store: accountStore } = useAccounts()

const form = reactive({
  date: toInputDate(new Date()),
  amount: '',
  sourceType: 'salary',
  accountId: '', // '' = no account (Unassigned); only used once at least one account exists
  note: '',
})

watch(
  () => [props.open, props.income],
  () => {
    if (!props.open) return
    if (props.income) {
      form.date = toInputDate(props.income.date)
      form.amount = props.income.amount
      form.sourceType = props.income.sourceType
      form.accountId = initialAccountId(accountStore, { mode: 'edit', current: props.income.accountId })
      form.note = props.income.note || ''
    } else {
      form.date = toInputDate(new Date())
      form.amount = ''
      form.sourceType = 'salary'
      form.accountId = initialAccountId(accountStore, { mode: 'create', lastAccountId: settings.lastAccountId, defaultAccountId: settings.defaultAccountId })
      form.note = ''
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  const amt = Number(form.amount)
  if (!(amt > 0)) {
    error.message = 'Amount must be greater than 0'
    return
  }
  const payload = {
    date: resolveSavedDate(props.income?.date, form.date), // unchanged day keeps the stored value; a new/changed day is saved as local noon
    amount: amt,
    sourceType: form.sourceType,
    note: form.note,
  }
  // The account is only sent when the picker was shown (an account exists); otherwise records are left untouched.
  if (accountStore.accounts.length) {
    payload.accountId = form.accountId
    if (!props.income) setLastAccountId(form.accountId)
  }
  emit('save', payload)
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ income ? 'Edit income' : 'Add income' }}</DialogTitle>
        <DialogDescription class="sr-only">Enter the date, amount and source of the income, choose an account if you use accounts, then save.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Amount</Label>
          <Input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Source</Label>
          <Select v-model="form.sourceType">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="s in INCOME_SOURCES" :key="s" :value="s">{{ INCOME_SOURCE_LABELS[s] }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AccountPicker v-model="form.accountId" />
        <div class="flex flex-col gap-1.5">
          <Label>Note (optional)</Label>
          <Input v-model="form.note" type="text" placeholder="e.g. August salary" />
        </div>
      </div>

      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>

      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">{{ income ? 'Save' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
