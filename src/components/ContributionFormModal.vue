<script setup>
import { reactive, watch } from 'vue'
import { toInputDate } from '../utils/date.js'
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
})

const emit = defineEmits(['close', 'save'])

const { settings, setLastAccountId } = useSettings()
const { store: accountStore } = useAccounts()

const form = reactive({
  date: toInputDate(new Date()),
  amount: '',
  accountId: '', // the account the money came out of; '' = none
  notes: '',
})

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
  if (!(Number(form.amount) > 0)) {
    error.message = 'Amount must be greater than 0'
    return
  }
  const payload = {
    date: new Date(form.date).toISOString(),
    amount: form.amount,
    notes: form.notes,
  }
  // Only sent when the picker was shown (an account exists); the money then leaves that account (never counted as spending).
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
        <DialogTitle>Add contribution</DialogTitle>
        <DialogDescription class="sr-only">Money you put into the fund. Choose the account it came from if you use accounts.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input v-model="form.date" type="date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Amount invested</Label>
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
