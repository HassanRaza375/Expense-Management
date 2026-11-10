<script setup>
import { reactive, ref, watch, nextTick } from 'vue'
import { useCategories } from '../composables/useCategories.js'
import { useSettings } from '../composables/useSettings.js'
import { useAccounts } from '../composables/useAccounts.js'
import { initialAccountId } from '../utils/accountsView.js'
import AccountPicker from './AccountPicker.vue'
import { localDayKey, addDays, isDayKey, resolveSavedDate } from '../utils/reporting.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  expense: { type: Object, default: null }, // null = create mode
})

// save(payload, { another }) — `another` is true for "Save & add another" (create mode only)
const emit = defineEmits(['close', 'save'])

const { sorted } = useCategories()
const { settings, setLastAccountId } = useSettings()
const { store: accountStore } = useAccounts()

const form = reactive({
  kind: 'expense', // 'expense' | 'refund'
  amount: '',
  date: '',
  categoryId: '',
  accountId: '', // '' = no account (Unassigned); only used once at least one account exists
  note: '',
})

const today = ref('')
const yesterday = ref('')
const addedCount = ref(0)
const error = reactive({ message: '' })
const amountInput = ref(null)

function startCategory() {
  const remembered = settings.lastCategoryId
  if (remembered && sorted().some((c) => c.id === remembered)) return remembered
  return sorted()[0]?.id || ''
}

function focusAmount() {
  // Dialogs move focus themselves when they open; wait for that, then put the cursor in Amount.
  nextTick(() => setTimeout(() => amountInput.value?.$el?.focus(), 80))
}

// Quick buttons hand focus straight back to Amount, so Enter still saves (a focused button would
// otherwise swallow Enter and re-trigger itself).
function pickDay(key) {
  form.date = key
  amountInput.value?.$el?.focus()
}
function pickKind(kind) {
  form.kind = kind
  amountInput.value?.$el?.focus()
}

watch(
  () => [props.open, props.expense],
  () => {
    if (!props.open) return
    error.message = ''
    addedCount.value = 0
    today.value = localDayKey(new Date())
    yesterday.value = addDays(today.value, -1)
    if (props.expense) {
      form.kind = props.expense.kind === 'refund' ? 'refund' : 'expense'
      form.amount = props.expense.amount
      // read through localDayKey so OLD (UTC-midnight) and NEW (local-noon) records both show the right day
      form.date = localDayKey(props.expense.date) || today.value
      form.categoryId = props.expense.categoryId
      form.accountId = initialAccountId(accountStore, { mode: 'edit', current: props.expense.accountId })
      form.note = props.expense.note || ''
    } else {
      form.kind = 'expense'
      form.amount = ''
      form.date = today.value
      form.categoryId = startCategory()
      form.accountId = initialAccountId(accountStore, { mode: 'create', lastAccountId: settings.lastAccountId, defaultAccountId: settings.defaultAccountId })
      form.note = ''
    }
    focusAmount()
  },
  { immediate: true }
)

function submit(another = false) {
  error.message = ''
  const amt = Number(form.amount)
  if (!(amt > 0)) {
    error.message = 'Enter an amount greater than 0'
    focusAmount()
    return
  }
  if (!form.categoryId) {
    error.message = 'Choose a category'
    return
  }
  if (!isDayKey(form.date)) {
    error.message = 'Pick a valid date'
    return
  }
  const keepOpen = another && !props.expense
  const payload = {
    // unchanged day => the stored date is kept as-is; a new/changed day is stored as local noon
    date: resolveSavedDate(props.expense?.date, form.date),
    amount: amt,
    categoryId: form.categoryId,
    note: form.note,
    kind: form.kind,
  }
  // The account is only sent when the picker was shown (an account exists); otherwise records are left untouched.
  if (accountStore.accounts.length) {
    payload.accountId = form.accountId
    if (!props.expense) setLastAccountId(form.accountId)
  }
  emit('save', payload, { another: keepOpen })
  if (keepOpen) {
    addedCount.value++
    form.amount = ''
    form.note = ''
    focusAmount()
  }
}

function categoryLabel(id) {
  const cat = sorted().find((c) => c.id === id)
  return cat ? `${cat.icon} ${cat.name}` : ''
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ expense ? (form.kind === 'refund' ? 'Edit refund' : 'Edit expense') : form.kind === 'refund' ? 'Add refund' : 'Add expense' }}</DialogTitle>
        <DialogDescription class="sr-only">Enter the amount, choose the day and category, then save. Press Enter to save.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit(false)">
        <div class="flex flex-col gap-1.5">
          <Label for="expense-amount">{{ form.kind === 'refund' ? 'Refund amount' : 'Amount' }}</Label>
          <Input
            id="expense-amount"
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

        <div class="flex flex-col gap-1.5">
          <div class="grid grid-cols-2 gap-2" role="group" aria-label="Type">
            <Button type="button" :variant="form.kind === 'expense' ? 'default' : 'outline'" :aria-pressed="form.kind === 'expense'" @click="pickKind('expense')">Expense</Button>
            <Button type="button" :variant="form.kind === 'refund' ? 'default' : 'outline'" :aria-pressed="form.kind === 'refund'" @click="pickKind('refund')">Refund</Button>
          </div>
          <p v-if="form.kind === 'refund'" class="m-0 text-xs text-muted-foreground">
            A refund is money coming back. It reduces your spending. Use the category of the original purchase.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="expense-date">Date</Label>
          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" :variant="form.date === today ? 'default' : 'outline'" @click="pickDay(today)">Today</Button>
            <Button type="button" size="sm" :variant="form.date === yesterday ? 'default' : 'outline'" @click="pickDay(yesterday)">Yesterday</Button>
            <Input id="expense-date" v-model="form.date" type="date" class="min-w-36 flex-1" />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>Category</Label>
          <Select v-model="form.categoryId">
            <SelectTrigger>
              <SelectValue placeholder="Choose a category">{{ categoryLabel(form.categoryId) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cat in sorted()" :key="cat.id" :value="cat.id">{{ cat.icon }} {{ cat.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <AccountPicker v-model="form.accountId" refocus-id="expense-amount" />

        <div class="flex flex-col gap-1.5">
          <Label for="expense-note">Note (optional)</Label>
          <Input id="expense-note" v-model="form.note" type="text" placeholder="What was this for?" autocomplete="off" />
        </div>

        <p v-if="error.message" class="m-0 text-sm text-destructive" role="alert">{{ error.message }}</p>
        <p v-else-if="addedCount" class="m-0 text-sm text-status-good" role="status">Added ({{ addedCount }} so far). Enter the next one.</p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('close')">{{ addedCount ? 'Done' : 'Cancel' }}</Button>
          <Button v-if="!expense" type="button" variant="outline" @click="submit(true)">Save &amp; add another</Button>
          <Button type="submit">{{ expense ? 'Save' : 'Add' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
