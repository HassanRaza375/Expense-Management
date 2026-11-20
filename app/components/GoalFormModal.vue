<script setup>
import { reactive, ref, watch, nextTick } from 'vue'
import { useAccounts } from '../composables/useAccounts.js'
import { validateGoal } from '../utils/goals.js'
import { localDayKey } from '../utils/reporting.js'
import AccountPicker from './AccountPicker.vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  goal: { type: Object, default: null }, // null = create mode
})
const emit = defineEmits(['close', 'save'])

const { store: accountStore } = useAccounts()
const form = reactive({ name: '', targetAmount: '', targetDate: '', accountId: '' })
const errors = ref([])
const nameInput = ref(null)

watch(
  () => [props.open, props.goal],
  () => {
    if (!props.open) return
    errors.value = []
    if (props.goal) {
      form.name = props.goal.name
      form.targetAmount = props.goal.targetAmount
      form.targetDate = props.goal.targetDate || ''
      form.accountId = accountStore.accounts.some((a) => a.id === props.goal.accountId) ? props.goal.accountId : ''
    } else {
      form.name = ''
      form.targetAmount = ''
      form.targetDate = ''
      form.accountId = ''
    }
    nextTick(() => setTimeout(() => nameInput.value?.$el?.focus(), 80))
  },
  { immediate: true }
)

function submit() {
  const input = { name: form.name, targetAmount: form.targetAmount, targetDate: form.targetDate, startDay: props.goal?.startDay || localDayKey(new Date()) }
  errors.value = validateGoal(input)
  if (errors.value.length) return
  const payload = { name: form.name.trim(), targetAmount: Number(form.targetAmount), targetDate: form.targetDate }
  // Only sent when the picker was shown (an account exists); '' clears the link on an existing goal.
  if (accountStore.accounts.length) payload.accountId = form.accountId
  emit('save', payload)
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ goal ? 'Edit goal' : 'Add a savings goal' }}</DialogTitle>
        <DialogDescription>
          Set an amount to reach, and optionally a date. Track it by hand, or follow an account so the goal moves with that account's balance.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <Label for="goal-name">Name</Label>
          <Input id="goal-name" ref="nameInput" v-model="form.name" type="text" placeholder="e.g. Emergency fund, Holiday" autocomplete="off" />
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label for="goal-target">Target amount</Label>
            <Input id="goal-target" v-model="form.targetAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" class="amount" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="goal-date">Target date (optional)</Label>
            <Input id="goal-date" v-model="form.targetDate" type="date" />
          </div>
        </div>
        <AccountPicker v-model="form.accountId" label="Follow an account (optional)" none-label="Track by hand" />
        <p v-if="form.accountId" class="m-0 text-xs text-muted-foreground">Progress will be this account's balance today. Saved-by-hand entries are ignored while an account is followed.</p>

        <ul v-if="errors.length" class="m-0 list-disc pl-5 text-sm text-destructive" role="alert" data-testid="goal-errors">
          <li v-for="e in errors" :key="e">{{ e }}</li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('close')">Cancel</Button>
          <Button type="submit" data-testid="save-goal">{{ goal ? 'Save' : 'Add goal' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
