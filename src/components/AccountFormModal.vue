<script setup>
import { reactive, ref, watch, nextTick } from 'vue'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, validateAccount } from '../utils/accountsView.js'
import { localDayKey, isDayKey } from '../utils/reporting.js'
import { useAccounts } from '../composables/useAccounts.js'
import { useSettings } from '../composables/useSettings.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  account: { type: Object, default: null }, // null = create mode
})
const emit = defineEmits(['close', 'save'])

const { accounts } = useAccounts()
const { settings } = useSettings()

const form = reactive({ name: '', type: 'bank', openingBalance: '', openingDate: '', notes: '' })
const errors = ref([])
const nameInput = ref(null)

watch(
  () => [props.open, props.account],
  () => {
    if (!props.open) return
    errors.value = []
    if (props.account) {
      form.name = props.account.name
      form.type = props.account.type
      form.openingBalance = props.account.openingBalance
      form.openingDate = isDayKey(props.account.openingDate) ? props.account.openingDate : localDayKey(new Date())
      form.notes = props.account.notes || ''
    } else {
      form.name = ''
      form.type = 'bank'
      form.openingBalance = ''
      form.openingDate = localDayKey(new Date())
      form.notes = ''
    }
    nextTick(() => setTimeout(() => nameInput.value?.$el?.focus(), 80))
  },
  { immediate: true }
)

function submit() {
  const input = { name: form.name, type: form.type, openingBalance: form.openingBalance, openingDate: form.openingDate }
  errors.value = validateAccount(input, { accounts, excludeId: props.account?.id ?? null })
  if (errors.value.length) return
  emit('save', { name: form.name.trim(), type: form.type, openingBalance: Number(form.openingBalance), openingDate: form.openingDate, notes: form.notes.trim() })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ account ? 'Edit account' : 'Add account' }}</DialogTitle>
        <DialogDescription class="sr-only">Name the account, choose its type, and enter its balance on the day you start tracking it.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <Label for="account-name">Name</Label>
          <Input id="account-name" ref="nameInput" v-model="form.name" type="text" placeholder="e.g. Meezan, Wallet, Visa" autocomplete="off" />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label id="account-type-label">Type</Label>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-labelledby="account-type-label">
            <Button
              v-for="t in ACCOUNT_TYPES"
              :key="t"
              type="button"
              size="sm"
              :variant="form.type === t ? 'default' : 'outline'"
              :aria-pressed="form.type === t"
              :data-testid="`type-${t}`"
              @click="form.type = t"
            >
              {{ ACCOUNT_TYPE_LABELS[t] }}
            </Button>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="account-balance">{{ form.type === 'card' ? 'Balance on that day (negative = you owe)' : 'Balance on that day' }}</Label>
          <Input
            id="account-balance"
            v-model="form.openingBalance"
            type="number"
            inputmode="decimal"
            step="0.01"
            placeholder="0.00"
            autocomplete="off"
            class="amount"
          />
          <p v-if="form.type === 'card'" class="m-0 text-xs text-muted-foreground">
            For a credit card enter what you owe as a negative number, e.g. -5000 means you owe {{ settings.currencySymbol }} 5,000.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="account-date">Balance is as of (start of this day)</Label>
          <Input id="account-date" v-model="form.openingDate" type="date" />
          <p class="m-0 text-xs text-muted-foreground">
            Only records on or after this day change the balance. Older records are treated as already inside it, so pick a recent day
            (today is fine) and you don't need to enter any history.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="account-notes">Notes (optional)</Label>
          <Textarea id="account-notes" v-model="form.notes" rows="2" placeholder="Anything you want to remember" />
        </div>

        <ul v-if="errors.length" class="m-0 list-disc pl-5 text-sm text-destructive" role="alert" data-testid="account-errors">
          <li v-for="e in errors" :key="e">{{ e }}</li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('close')">Cancel</Button>
          <Button type="submit" data-testid="save-account">{{ account ? 'Save' : 'Add account' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
