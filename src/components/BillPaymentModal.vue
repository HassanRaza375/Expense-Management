<script setup>
import { reactive, watch, ref } from 'vue'
import { useBills, PAYMENT_METHODS } from '../composables/useBills.js'
import { useCategories } from '../composables/useCategories.js'
import { toInputDate } from '../utils/date.js'
import { localNoonISO, isDayKey } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import { useSettings } from '../composables/useSettings.js'
import { useExpenses } from '../composables/useExpenses.js'
import { useAccounts } from '../composables/useAccounts.js'
import { initialAccountId } from '../utils/accountsView.js'
import AccountPicker from './AccountPicker.vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  bill: { type: Object, default: null },
})

const emit = defineEmits(['close', 'paid'])

const { markPaid } = useBills()
const { sorted, findById } = useCategories()
const { settings, setLastAccountId } = useSettings()
const { findById: findExpense } = useExpenses()
const { store: accountStore } = useAccounts()

const form = reactive({
  paidDate: toInputDate(new Date()),
  paidBy: settings.profileName || '',
  paymentMethod: 'cash',
  transactionReference: '',
  categoryId: '',
  accountId: '', // the account the bill was paid from; '' = none
})
const error = ref('')

watch(
  () => props.open,
  () => {
    if (!props.open) return
    error.value = ''
    form.paidDate = toInputDate(new Date())
    form.paidBy = settings.profileName || ''
    form.paymentMethod = 'cash'
    form.transactionReference = ''
    // Paying again after the payment was edited: start from the account the existing payment already uses.
    const existing = props.bill?.linkedExpenseId ? findExpense(props.bill.linkedExpenseId) : null
    form.accountId = existing
      ? initialAccountId(accountStore, { mode: 'edit', current: existing.accountId })
      : initialAccountId(accountStore, { mode: 'create', lastAccountId: settings.lastAccountId, defaultAccountId: settings.defaultAccountId })
    const billsCategory = sorted().find((c) => c.name.toLowerCase() === 'bills')
    form.categoryId = billsCategory?.id || sorted()[0]?.id || ''
  },
  { immediate: true }
)

function submit() {
  error.value = ''
  if (!isDayKey(form.paidDate)) {
    error.value = 'Pick the payment date'
    return
  }
  try {
    const payload = {
      paidDate: localNoonISO(form.paidDate),
      paidBy: form.paidBy,
      paymentMethod: form.paymentMethod,
      transactionReference: form.transactionReference,
      categoryId: form.categoryId,
    }
    // Only sent when the picker was shown (an account exists); otherwise the payment is recorded exactly as before.
    if (accountStore.accounts.length) {
      payload.accountId = form.accountId
      setLastAccountId(form.accountId)
    }
    markPaid(props.bill.id, payload)
    emit('paid')
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Mark bill as paid</DialogTitle>
        <DialogDescription v-if="bill">
          {{ formatCurrency((bill.amount || 0) + (bill.arrears || 0), settings.currencySymbol) }} — creates a linked expense.
        </DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Paid date</Label>
          <Input v-model="form.paidDate" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Paid by</Label>
          <Input v-model="form.paidBy" type="text" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Payment method</Label>
          <Select v-model="form.paymentMethod">
            <SelectTrigger><SelectValue>{{ PAYMENT_METHODS.find((m) => m.value === form.paymentMethod)?.label }}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in PAYMENT_METHODS" :key="m.value" :value="m.value">{{ m.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AccountPicker v-model="form.accountId" />
        <div class="flex flex-col gap-1.5">
          <Label>Transaction reference (optional)</Label>
          <Input v-model="form.transactionReference" type="text" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Expense category</Label>
          <Select v-model="form.categoryId">
            <SelectTrigger><SelectValue>{{ findById(form.categoryId)?.icon }} {{ findById(form.categoryId)?.name }}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cat in sorted()" :key="cat.id" :value="cat.id">{{ cat.icon }} {{ cat.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">Mark paid</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
