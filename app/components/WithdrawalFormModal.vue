<script setup>
import { reactive, watch } from 'vue'
import { toInputDate } from '../utils/date.js'
import { formatCurrency } from '../utils/currency.js'
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
  maxAmount: { type: Number, default: 0 }, // what the fund is worth now
})

const emit = defineEmits(['close', 'save'])

const { settings, setLastAccountId } = useSettings()
const { store: accountStore } = useAccounts()

const form = reactive({ date: toInputDate(new Date()), amount: '', accountId: '', notes: '' })

watch(
  () => props.open,
  () => {
    if (!props.open) return
    form.date = toInputDate(new Date())
    form.amount = ''
    form.accountId = initialAccountId(accountStore, { mode: 'create', lastAccountId: settings.lastAccountId, defaultAccountId: settings.defaultAccountId })
    form.notes = ''
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
  if (amt > props.maxAmount + 0.005) {
    error.message = 'You cannot take out more than the fund is worth (' + formatCurrency(props.maxAmount, settings.currencySymbol) + ')'
    return
  }
  // Saved like the fund's other entries (UTC midnight of the chosen day) so same-day ordering stays consistent.
  const payload = { date: new Date(form.date).toISOString(), amount: amt, notes: form.notes }
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
        <DialogTitle>Withdraw from fund</DialogTitle>
        <DialogDescription>
          Money you take out of the fund. The gain on what you sell is recorded as realized, and the rest stays unrealized. If you pick an account, the money is added to it.
        </DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Amount withdrawn</Label>
          <Input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" />
          <p class="m-0 text-xs text-muted-foreground">The fund is worth {{ formatCurrency(maxAmount, settings.currencySymbol) }}.</p>
        </div>
        <AccountPicker v-model="form.accountId" />
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
        </div>
      </div>
      <p v-if="error.message" class="m-0 text-sm text-destructive" role="alert">{{ error.message }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">Withdraw</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
