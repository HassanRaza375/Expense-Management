<script setup>
import { reactive, computed, ref, watch, nextTick } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import { localDayKey } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import { useAccounts } from '../composables/useAccounts.js'
import { useSettings } from '../composables/useSettings.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  account: { type: Object, default: null },
})
// done({ adjustment }) — adjustment is null when the balance already matched
const emit = defineEmits(['close', 'done'])

const { reconcileFor, balanceOf, reconcile } = useAccounts()
const { settings } = useSettings()

const form = reactive({ actual: '', date: '' })
const today = ref('')
const error = ref('')
const actualInput = ref(null)

const money = (n) => formatCurrency(n, settings.currencySymbol).replace(/^-/, '−')

watch(
  () => [props.open, props.account],
  () => {
    if (!props.open) return
    error.value = ''
    today.value = localDayKey(new Date())
    form.actual = ''
    form.date = today.value
    nextTick(() => setTimeout(() => actualInput.value?.$el?.focus(), 80))
  },
  { immediate: true }
)

// Everything below is derived by the pure functions (utils/accountsView.js -> accounts.js); this component only displays it.
const expected = computed(() => (props.account ? balanceOf(props.account.id, { asOf: /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : undefined })?.balance ?? null : null))
const view = computed(() => (props.account ? reconcileFor(props.account.id, { actual: form.actual, asOf: form.date, format: money }) : null))
const diffText = computed(() => (view.value?.valid && view.value.needsCorrection ? `${view.value.difference > 0 ? '+' : '−'}${money(Math.abs(view.value.difference))}` : ''))

function submit() {
  error.value = ''
  if (!view.value?.valid) {
    error.value = view.value?.error || 'Enter the real balance'
    return
  }
  if (!view.value.needsCorrection) {
    emit('done', { adjustment: null })
    return
  }
  try {
    const result = reconcile(props.account.id, { actual: form.actual, asOf: form.date })
    emit('done', { adjustment: result.adjustment })
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent v-if="account">
      <DialogHeader>
        <DialogTitle>Reconcile {{ account.name }}</DialogTitle>
        <DialogDescription>
          Enter the balance you really have (from your bank app, wallet or cash count). If it differs from the app, a visible "Correction" is added.
          It is never counted as spending.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <Label for="reconcile-date">As of</Label>
          <Input id="reconcile-date" v-model="form.date" type="date" :max="today" />
        </div>

        <dl class="m-0 grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-sm">
          <div class="min-w-0">
            <dt class="text-xs text-muted-foreground">The app calculates</dt>
            <dd class="amount m-0 font-semibold" data-testid="reconcile-expected">{{ expected === null ? '—' : money(expected) }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs text-muted-foreground">Difference</dt>
            <dd class="amount m-0 font-semibold" data-testid="reconcile-diff">{{ view?.valid ? (view.needsCorrection ? diffText : 'None') : '—' }}</dd>
          </div>
        </dl>

        <div class="flex flex-col gap-1.5">
          <Label for="reconcile-actual">Your real balance</Label>
          <Input
            id="reconcile-actual"
            ref="actualInput"
            v-model="form.actual"
            type="number"
            inputmode="decimal"
            step="0.01"
            placeholder="0.00"
            autocomplete="off"
            class="amount h-12 text-2xl"
          />
          <p v-if="account.type === 'card'" class="m-0 text-xs text-muted-foreground">For a credit card, a negative number means you owe that much.</p>
        </div>

        <p v-if="form.actual !== '' && view && !view.valid" class="m-0 text-sm text-destructive" role="alert">{{ view.error }}</p>
        <div v-else-if="view?.valid" class="flex flex-col gap-2 text-sm" role="status">
          <p class="m-0" data-testid="reconcile-message">{{ view.message }}</p>
          <p v-if="view.hint" class="m-0 flex gap-2 text-muted-foreground">
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-status-warn" />
            <span>{{ view.hint }}</span>
          </p>
        </div>
        <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('close')">Cancel</Button>
          <Button type="submit" :disabled="!view?.valid" data-testid="reconcile-confirm">
            {{ view?.valid && view.needsCorrection ? `Add correction of ${diffText}` : view?.valid ? 'Matches, close' : 'Add correction' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
