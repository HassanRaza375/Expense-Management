<script setup>
import { reactive, ref, watch, nextTick } from 'vue'
import { ArrowLeftRight } from '@lucide/vue'
import { transferChoices, defaultTransferPair, validateTransfer } from '../utils/accountsView.js'
import { localDayKey, addDays, isDayKey, resolveSavedDate } from '../utils/reporting.js'
import { useAccounts } from '../composables/useAccounts.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  transfer: { type: Object, default: null }, // null = create mode
  fromAccountId: { type: String, default: '' }, // preselected "From" for a new transfer
})
const emit = defineEmits(['close', 'save'])

const { store, findAccount } = useAccounts()

const form = reactive({ from: '', to: '', amount: '', date: '', note: '' })
const today = ref('')
const yesterday = ref('')
const errors = ref([])
const amountInput = ref(null)

function choices() {
  // active accounts, plus an archived one this transfer already uses (so an old transfer stays editable)
  return transferChoices(store, props.transfer ? [props.transfer.fromAccountId, props.transfer.toAccountId] : [])
}
const nameOf = (id) => findAccount(id)?.name || ''

watch(
  () => [props.open, props.transfer],
  () => {
    if (!props.open) return
    errors.value = []
    today.value = localDayKey(new Date())
    yesterday.value = addDays(today.value, -1)
    if (props.transfer) {
      form.from = props.transfer.fromAccountId
      form.to = props.transfer.toAccountId
      form.amount = props.transfer.amount
      form.date = localDayKey(props.transfer.date) || today.value
      form.note = props.transfer.note || ''
    } else {
      const pair = defaultTransferPair(store, props.fromAccountId)
      form.from = pair.fromAccountId
      form.to = pair.toAccountId
      form.amount = ''
      form.date = today.value
      form.note = ''
    }
    nextTick(() => setTimeout(() => amountInput.value?.$el?.focus(), 80))
  },
  { immediate: true }
)

// Choosing the account the other end already uses swaps them, so the form never sits in an invalid state.
function setFrom(id) {
  if (id === form.to) form.to = form.from
  form.from = id
}
function setTo(id) {
  if (id === form.from) form.from = form.to
  form.to = id
}
function swap() {
  ;[form.from, form.to] = [form.to, form.from]
  amountInput.value?.$el?.focus()
}
function pickDay(key) {
  form.date = key
  amountInput.value?.$el?.focus()
}

function submit() {
  const payload = { fromAccountId: form.from, toAccountId: form.to, amount: form.amount, date: isDayKey(form.date) ? resolveSavedDate(props.transfer?.date, form.date) : '' }
  errors.value = validateTransfer(store, payload, { requireActive: !props.transfer })
  if (errors.value.length) return
  emit('save', { ...payload, amount: Number(form.amount), note: form.note.trim() })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ transfer ? 'Edit transfer' : 'Transfer money' }}</DialogTitle>
        <DialogDescription class="sr-only">Move money between two of your accounts. A transfer is not an expense and not income.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <Label for="transfer-amount">Amount</Label>
          <Input
            id="transfer-amount"
            ref="amountInput"
            v-model="form.amount"
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            autocomplete="off"
            class="amount h-12 text-2xl"
          />
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div class="flex min-w-0 flex-col gap-1.5">
            <Label>From</Label>
            <Select :model-value="form.from" @update:model-value="setFrom">
              <SelectTrigger data-testid="transfer-from"><SelectValue placeholder="Choose">{{ nameOf(form.from) }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="a in choices()" :key="a.id" :value="a.id">{{ a.name }}{{ a.archived ? ' (archived)' : '' }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="icon" title="Swap From and To" aria-label="Swap From and To" data-testid="transfer-swap" @click="swap">
            <ArrowLeftRight class="h-4 w-4" />
          </Button>
          <div class="flex min-w-0 flex-col gap-1.5">
            <Label>To</Label>
            <Select :model-value="form.to" @update:model-value="setTo">
              <SelectTrigger data-testid="transfer-to"><SelectValue placeholder="Choose">{{ nameOf(form.to) }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="a in choices()" :key="a.id" :value="a.id">{{ a.name }}{{ a.archived ? ' (archived)' : '' }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="transfer-date">Date</Label>
          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" :variant="form.date === today ? 'default' : 'outline'" @click="pickDay(today)">Today</Button>
            <Button type="button" size="sm" :variant="form.date === yesterday ? 'default' : 'outline'" @click="pickDay(yesterday)">Yesterday</Button>
            <Input id="transfer-date" v-model="form.date" type="date" class="min-w-36 flex-1" />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="transfer-note">Note (optional)</Label>
          <Input id="transfer-note" v-model="form.note" type="text" placeholder="e.g. ATM withdrawal, card payment" autocomplete="off" />
        </div>

        <p class="m-0 text-xs text-muted-foreground">
          A transfer moves money between your accounts. It is not an expense and not income, so it never changes your spending or budget.
          A fee is a normal expense.
        </p>

        <ul v-if="errors.length" class="m-0 list-disc pl-5 text-sm text-destructive" role="alert" data-testid="transfer-errors">
          <li v-for="e in errors" :key="e">{{ e }}</li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('close')">Cancel</Button>
          <Button type="submit" data-testid="save-transfer">{{ transfer ? 'Save' : 'Transfer' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
