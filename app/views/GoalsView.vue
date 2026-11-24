<script setup>
import { ref, computed, reactive } from 'vue'
import { Plus, Pencil, Trash2, Target, Landmark } from '@lucide/vue'
import { useGoals } from '../composables/useGoals.js'
import { useAccounts } from '../composables/useAccounts.js'
import { useSettings } from '../composables/useSettings.js'
import { GOAL_STATUS_LABELS } from '../utils/goals.js'
import { formatDayKey, localDayKey } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import GoalFormModal from '../components/GoalFormModal.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Progress } from '@/components/ui/progress/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const { goals, addGoal, updateGoal, deleteGoal, undoDelete, addSaving, deleteSaving, progress } = useGoals()
const { balanceOf, findAccount } = useAccounts()
const { settings } = useSettings()

const money = (n) => formatCurrency(n, settings.currencySymbol)
const accountBalanceOf = (id) => {
  const b = balanceOf(id)
  return b ? b.balance : null
}

// Everything shown comes from goalProgress() (utils/goals.js); the screen only formats it.
const cards = computed(() =>
  goals
    .map((g) => ({ goal: g, p: progress(g, accountBalanceOf), account: g.accountId ? findAccount(g.accountId) : null }))
    .sort((a, b) => Number(a.p.reached) - Number(b.p.reached) || (a.goal.targetDate || '9999').localeCompare(b.goal.targetDate || '9999'))
)

const STATUS_VARIANT = { reached: 'good', 'on-track': 'good', behind: 'warn', overdue: 'over', 'no-date': 'secondary' }
const STATUS_BAR = { reached: 'good', 'on-track': 'good', behind: 'warn', overdue: 'over', 'no-date': '' }

const formOpen = ref(false)
const editing = ref(null)
function openAdd() {
  editing.value = null
  formOpen.value = true
}
function openEdit(goal) {
  editing.value = goal
  formOpen.value = true
}
function saveGoal(payload) {
  try {
    if (editing.value) updateGoal(editing.value.id, payload)
    else addGoal(payload)
    formOpen.value = false
    toast.success(editing.value ? 'Goal saved' : 'Goal added')
  } catch (e) {
    toast.error(e.message)
  }
}

function removeGoal(goal) {
  deleteGoal(goal.id)
  toast('Goal deleted', { action: { label: 'Undo', onClick: () => undoDelete() } })
}

// ---- put money aside / take it out (goals that do not follow an account)
const savingFor = ref(null)
const saving = reactive({ amount: '', direction: 'add', date: '', note: '' })
const savingError = ref('')
function openSaving(goal) {
  savingFor.value = goal
  saving.amount = ''
  saving.direction = 'add'
  saving.date = localDayKey(new Date())
  saving.note = ''
  savingError.value = ''
}
function confirmSaving() {
  const amt = Number(saving.amount)
  if (!(amt > 0)) {
    savingError.value = 'Enter an amount greater than 0'
    return
  }
  try {
    addSaving(savingFor.value.id, { date: saving.date, amount: saving.direction === 'add' ? amt : -amt, note: saving.note })
    savingFor.value = null
    toast.success(saving.direction === 'add' ? 'Added to the goal' : 'Taken out of the goal')
  } catch (e) {
    savingError.value = e.message
  }
}
function removeSaving(goal, entry) {
  deleteSaving(goal.id, entry.id)
  toast('Entry removed')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-xl">Goals</h2>
        <p class="mt-1 text-sm text-muted-foreground">Things you are saving for. Track them by hand, or follow an account.</p>
      </div>
      <Button data-testid="add-goal" @click="openAdd"><Plus class="h-4 w-4" /> Add goal</Button>
    </div>

    <Card v-if="!goals.length">
      <CardContent class="flex flex-col items-center gap-3 p-10 text-center">
        <Target class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p class="m-0 font-medium">No goals yet</p>
        <p class="m-0 max-w-md text-sm text-muted-foreground">Add something you are saving for, like an emergency fund or a holiday, and see how far along you are.</p>
        <Button @click="openAdd"><Plus class="h-4 w-4" /> Add goal</Button>
      </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card v-for="{ goal, p, account } in cards" :key="goal.id" data-testid="goal-card">
        <CardContent class="flex flex-col gap-3 p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-medium">{{ goal.name }}</div>
              <div class="text-xs text-muted-foreground">
                <template v-if="goal.targetDate">By {{ formatDayKey(goal.targetDate) }}</template>
                <template v-else>No target date</template>
              </div>
            </div>
            <Badge :variant="STATUS_VARIANT[p.status]" data-testid="goal-status">{{ GOAL_STATUS_LABELS[p.status] }}</Badge>
          </div>

          <div>
            <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span class="amount font-semibold" data-testid="goal-saved">{{ money(p.saved) }}</span>
              <span class="amount text-muted-foreground">of {{ money(p.target) }} · {{ Math.floor(p.pctRaw) }}%</span>
            </div>
            <Progress :model-value="p.pct" :status="STATUS_BAR[p.status]" />
          </div>

          <p v-if="p.reached" class="m-0 text-sm text-status-good">You have reached this goal.</p>
          <p v-else-if="p.requiredPerMonth !== null" class="m-0 text-sm text-muted-foreground" data-testid="goal-pace">
            {{ money(p.remaining) }} to go. Putting aside about <span class="amount font-medium text-foreground">{{ money(p.requiredPerMonth) }}</span> a month gets you there by {{ formatDayKey(goal.targetDate) }}.
          </p>
          <p v-else-if="p.status === 'overdue'" class="m-0 text-sm text-muted-foreground">{{ money(p.remaining) }} still to go. Edit the goal to set a new date.</p>
          <p v-else class="m-0 text-sm text-muted-foreground">{{ money(p.remaining) }} to go.</p>

          <p v-if="account && p.source === 'account'" class="m-0 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Landmark class="h-3.5 w-3.5" aria-hidden="true" /> Follows {{ account.name }}
          </p>
          <p v-else-if="p.accountMissing" class="m-0 text-xs text-status-warn">The account this goal followed no longer exists, so it uses the money you added by hand.</p>

          <div class="flex flex-wrap items-center gap-2">
            <Button v-if="p.source === 'manual'" size="sm" variant="outline" data-testid="goal-add-money" @click="openSaving(goal)"><Plus class="h-4 w-4" /> Add or take out money</Button>
            <div class="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" title="Edit goal" aria-label="Edit goal" @click="openEdit(goal)"><Pencil class="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Delete goal" aria-label="Delete goal" data-testid="goal-delete" @click="removeGoal(goal)"><Trash2 class="h-4 w-4" /></Button>
            </div>
          </div>

          <details v-if="p.source === 'manual' && goal.savings?.length" class="text-sm">
            <summary class="cursor-pointer text-muted-foreground">Entries ({{ goal.savings.length }})</summary>
            <div class="mt-2 flex flex-col gap-1">
              <div v-for="e in [...goal.savings].reverse()" :key="e.id" class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-muted-foreground">{{ formatDayKey(e.date) }}<span v-if="e.note"> · {{ e.note }}</span></span>
                <span class="amount whitespace-nowrap">{{ e.amount < 0 ? '−' : '+' }}{{ money(Math.abs(e.amount)) }}</span>
                <Button variant="ghost" size="icon" title="Remove entry" aria-label="Remove entry" @click="removeSaving(goal, e)"><Trash2 class="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>

    <GoalFormModal :open="formOpen" :goal="editing" @close="formOpen = false" @save="saveGoal" />

    <Dialog :open="!!savingFor" @update:open="(v) => !v && (savingFor = null)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>{{ savingFor?.name }}</DialogTitle>
          <DialogDescription>Record money you put aside for this goal, or took back out.</DialogDescription>
        </DialogHeader>
        <form class="flex flex-col gap-3" @submit.prevent="confirmSaving">
          <div class="grid grid-cols-2 gap-2" role="group" aria-label="Add or take out">
            <Button type="button" :variant="saving.direction === 'add' ? 'default' : 'outline'" :aria-pressed="saving.direction === 'add'" @click="saving.direction = 'add'">Add money</Button>
            <Button type="button" :variant="saving.direction === 'out' ? 'default' : 'outline'" :aria-pressed="saving.direction === 'out'" @click="saving.direction = 'out'">Take out</Button>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="saving-amount">Amount</Label>
            <Input id="saving-amount" v-model="saving.amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" class="amount h-11 text-xl" autocomplete="off" />
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <Label for="saving-date">Date</Label>
              <Input id="saving-date" v-model="saving.date" type="date" />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="saving-note">Note (optional)</Label>
              <Input id="saving-note" v-model="saving.note" type="text" autocomplete="off" />
            </div>
          </div>
          <p v-if="savingError" class="m-0 text-sm text-destructive" role="alert">{{ savingError }}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" @click="savingFor = null">Cancel</Button>
            <Button type="submit" data-testid="confirm-saving">{{ saving.direction === 'add' ? 'Add' : 'Take out' }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
