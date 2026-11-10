<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowLeftRight, Scale, Pencil, Archive, ArchiveRestore, Trash2 } from '@lucide/vue'
import { useAccounts } from '../composables/useAccounts.js'
import { INCOME_SOURCE_LABELS } from '../composables/useIncome.js'
import { useCategories } from '../composables/useCategories.js'
import { useSettings } from '../composables/useSettings.js'
import { ledgerView, limitGroups, unassignedSummary, accountCards } from '../utils/accountsView.js'
import { formatDayKey, isDayKey } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import AccountFormModal from '../components/AccountFormModal.vue'
import TransferFormModal from '../components/TransferFormModal.vue'
import ReconcileModal from '../components/ReconcileModal.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const route = useRoute()
const router = useRouter()
const { store, findAccount, updateAccount, archiveAccount, unarchiveAccount, deleteAccount, undoDeleteAccount, referenceCount, addTransfer, updateTransfer, deleteTransfer, undoDeleteTransfer, deleteAdjustment, undoDeleteAdjustment, records } = useAccounts()
const { findById: findCategory } = useCategories()
const { settings, setDefaultAccountId } = useSettings()
const isDefault = computed(() => !!account.value && settings.defaultAccountId === account.value.id)
function toggleDefault() {
  setDefaultAccountId(isDefault.value ? '' : account.value.id)
  toast.success(isDefault.value ? account.value.name + ' is now the default account for new records' : 'No default account')
}

const symbol = computed(() => settings.currencySymbol)
const money = (n) => formatCurrency(n, symbol.value)
const account = computed(() => findAccount(String(route.params.id)))
const data = computed(() => records())

const lookups = computed(() => ({
  categoryName: (id) => findCategory(id)?.name || '',
  incomeLabel: (t) => INCOME_SOURCE_LABELS[t] || '',
  accountName: (id) => findAccount(id)?.name || '',
}))

const PAGE = 40
const visibleRows = ref(PAGE)

const ledger = computed(() => (account.value && isDayKey(account.value.openingDate) ? ledgerView(account.value, store, data.value, { lookups: lookups.value }) : null))
const shown = computed(() => (ledger.value ? limitGroups(ledger.value.groups, visibleRows.value) : { groups: [], hasMore: false, shown: 0, total: 0 }))
const cards = computed(() => accountCards(store, data.value))
const card = computed(() => (account.value ? [...cards.value.active, ...cards.value.archived].find((c) => c.id === account.value.id) : null))
const unassigned = computed(() => (account.value ? unassignedSummary(store, data.value, account.value.openingDate) : { text: '' }))
const refs = computed(() => (account.value ? referenceCount(account.value.id) : 0))
const canTransfer = computed(() => store.accounts.filter((a) => !a.archived).length >= 2)

// ---- dialogs ----
const editOpen = ref(false)
const transferOpen = ref(false)
const editingTransfer = ref(null)
const reconcileOpen = ref(false)
const deleteOpen = ref(false)
const confirmRow = ref(null) // a transfer/correction row awaiting delete confirmation

function saveEdit(payload) {
  try {
    updateAccount(account.value.id, payload)
    editOpen.value = false
    toast.success('Account saved')
  } catch (e) {
    toast.error(e.message)
  }
}

function openTransfer(row = null) {
  editingTransfer.value = row ? row.record : null
  transferOpen.value = true
}

function saveTransfer(payload) {
  try {
    if (editingTransfer.value) updateTransfer(editingTransfer.value.id, payload)
    else addTransfer(payload)
    toast.success('Transfer saved')
    transferOpen.value = false
  } catch (e) {
    toast.error(e.message)
  }
}

function reconciled({ adjustment }) {
  reconcileOpen.value = false
  if (adjustment) {
    const id = adjustment.id
    toast('Correction added', { action: { label: 'Undo', onClick: () => deleteAdjustment(id) } })
  } else {
    toast('Balance matches: no correction needed')
  }
}

function askDelete(row) {
  confirmRow.value = row
}

function confirmDeleteRow() {
  const row = confirmRow.value
  confirmRow.value = null
  if (!row) return
  if (row.type === 'correction') {
    deleteAdjustment(row.record.id)
    toast('Correction deleted', { action: { label: 'Undo', onClick: () => undoDeleteAdjustment() } })
  } else {
    deleteTransfer(row.record.id)
    toast('Transfer deleted', { action: { label: 'Undo', onClick: () => undoDeleteTransfer() } })
  }
}

function toggleArchive() {
  if (account.value.archived) {
    unarchiveAccount(account.value.id)
    toast.success('Account restored')
  } else {
    archiveAccount(account.value.id)
    toast.success('Account archived')
  }
}

function doDelete() {
  const name = account.value.name
  try {
    deleteAccount(account.value.id)
    deleteOpen.value = false
    router.push('/accounts')
    toast(`${name} deleted`, { action: { label: 'Undo', onClick: () => undoDeleteAccount() } })
  } catch (e) {
    deleteOpen.value = false
    toast.error(e.message)
  }
}

const rowTone = (row) => (row.type === 'correction' ? 'text-muted-foreground' : row.amount > 0 ? 'text-status-good' : '')
</script>

<template>
  <div v-if="!account" class="flex flex-col items-start gap-3">
    <p class="m-0 text-muted-foreground">This account was not found.</p>
    <Button variant="outline" @click="router.push('/accounts')"><ArrowLeft class="h-4 w-4" /> Back to accounts</Button>
  </div>

  <div v-else class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="icon" title="Back to accounts" aria-label="Back to accounts" @click="router.push('/accounts')"><ArrowLeft class="h-4 w-4" /></Button>
      <h2 class="m-0 min-w-0 flex-1 truncate text-lg font-semibold">{{ account.name }}</h2>
      <Badge v-if="account.archived" variant="warn">Archived</Badge>
    </div>

    <Card>
      <CardContent class="flex flex-col gap-3 p-4">
        <div>
          <div class="text-sm text-muted-foreground">{{ card?.display?.label || 'Balance' }} · {{ card?.typeLabel }}</div>
          <div v-if="card?.display" class="amount text-3xl font-semibold" data-testid="detail-balance">
            {{ card.display.label === 'Owed' ? 'Owed ' : '' }}{{ money(card.display.label === 'Owed' ? card.display.amount : card.display.signed) }}
          </div>
          <p v-if="card?.display?.hint" class="m-0 mt-1 text-xs text-muted-foreground">{{ card.display.hint }}</p>
          <p v-if="card?.problem" class="m-0 mt-1 text-sm text-destructive">{{ card.problem }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button v-if="canTransfer && !account.archived" class="flex-1 sm:flex-none" @click="openTransfer()"><ArrowLeftRight class="h-4 w-4" /> Transfer</Button>
          <Button variant="outline" class="flex-1 sm:flex-none" @click="reconcileOpen = true"><Scale class="h-4 w-4" /> Reconcile</Button>
          <Button variant="outline" class="flex-1 sm:flex-none" @click="editOpen = true"><Pencil class="h-4 w-4" /> Edit</Button>
          <Button variant="outline" class="flex-1 sm:flex-none" @click="toggleArchive">
            <component :is="account.archived ? ArchiveRestore : Archive" class="h-4 w-4" /> {{ account.archived ? 'Restore' : 'Archive' }}
          </Button>
          <Button v-if="!account.archived" variant="outline" class="flex-1 sm:flex-none" :aria-pressed="isDefault" data-testid="toggle-default" @click="toggleDefault">{{ isDefault ? 'Default account' : 'Make default' }}</Button>
          <Button variant="ghost" class="flex-1 sm:flex-none" :title="refs ? 'In use: archive it instead' : 'Delete account'" @click="deleteOpen = true"><Trash2 class="h-4 w-4" /> Delete</Button>
        </div>
      </CardContent>
    </Card>

    <div v-if="ledger?.olderThanOpening || ledger?.scheduledCount || unassigned.text" class="flex flex-col gap-1 rounded-md border border-border p-3 text-sm text-muted-foreground" role="note">
      <p v-if="ledger?.olderThanOpening" class="m-0">
        {{ ledger.olderThanOpening }} record{{ ledger.olderThanOpening === 1 ? ' is' : 's are' }} older than this account's opening date and {{ ledger.olderThanOpening === 1 ? 'is' : 'are' }} not counted.
      </p>
      <p v-if="ledger?.scheduledCount" class="m-0">{{ ledger.scheduledCount }} future-dated record{{ ledger.scheduledCount === 1 ? '' : 's' }} not counted yet.</p>
      <p v-if="unassigned.text" class="m-0">{{ unassigned.text }}. Assign an account to an expense or income record to include it here.</p>
    </div>

    <div v-if="ledger" class="flex flex-col gap-3">
      <div v-for="group in shown.groups" :key="group.dayKey" class="flex flex-col gap-2" data-testid="ledger-day">
        <div class="flex justify-between px-1 text-sm text-muted-foreground">
          <span>{{ formatDayKey(group.dayKey, { weekday: true }) }}<span v-if="group.scheduled"> · scheduled</span></span>
          <span class="amount">{{ group.net > 0 ? '+' : group.net < 0 ? '−' : '' }}{{ money(Math.abs(group.net)) }}</span>
        </div>
        <Card class="overflow-hidden py-0">
          <div v-for="row in group.items" :key="row.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0" data-testid="ledger-row">
            <div class="min-w-0 flex-1 basis-32">
              <div class="truncate font-medium">{{ row.title }}</div>
              <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline">{{ row.label }}</Badge>
                <span v-if="row.subtitle" class="truncate">{{ row.subtitle }}</span>
                <span v-if="row.reconciledTo !== null">reconciled to {{ money(row.reconciledTo) }}</span>
              </div>
            </div>
            <div class="ml-auto flex items-center gap-2">
              <div class="text-right">
                <div class="amount whitespace-nowrap font-semibold" :class="rowTone(row)">{{ row.sign }}{{ money(Math.abs(row.amount)) }}</div>
                <div class="amount hidden text-xs text-muted-foreground sm:block">{{ money(row.running) }}</div>
              </div>
              <div class="flex gap-1">
                <Button v-if="row.editable" variant="ghost" size="icon" title="Edit transfer" aria-label="Edit transfer" @click="openTransfer(row)"><Pencil class="h-4 w-4" /></Button>
                <Button v-if="row.deletable" variant="ghost" size="icon" title="Delete" aria-label="Delete" @click="askDelete(row)"><Trash2 class="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Button v-if="shown.hasMore" variant="outline" @click="visibleRows += PAGE">Show more ({{ shown.total - shown.shown }} older)</Button>

      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="min-w-0 flex-1">
            <div class="font-medium">Opening balance</div>
            <div class="text-xs text-muted-foreground">at the start of {{ formatDayKey(account.openingDate) }}</div>
          </div>
          <div class="amount font-semibold">{{ money(ledger.opening.amount) }}</div>
        </CardContent>
      </Card>

      <Card v-if="!ledger.rowCount">
        <CardContent class="p-6 text-center text-sm text-muted-foreground">
          Nothing recorded for this account yet. Choose this account when you add an expense or income, or make a transfer.
        </CardContent>
      </Card>
    </div>

    <AccountFormModal :open="editOpen" :account="account" @close="editOpen = false" @save="saveEdit" />
    <TransferFormModal :open="transferOpen" :transfer="editingTransfer" :from-account-id="account.id" @close="transferOpen = false" @save="saveTransfer" />
    <ReconcileModal :open="reconcileOpen" :account="account" @close="reconcileOpen = false" @done="reconciled" />

    <Dialog :open="!!confirmRow" @update:open="(v) => !v && (confirmRow = null)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ confirmRow?.type === 'correction' ? 'Delete this correction?' : 'Delete this transfer?' }}</DialogTitle>
          <DialogDescription>
            {{ confirmRow?.type === 'correction' ? 'The balance goes back to what the records alone give.' : 'The money moves back: both accounts change.' }} You can undo this right after.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="confirmRow = null">Cancel</Button>
          <Button variant="destructive" @click="confirmDeleteRow">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="deleteOpen" @update:open="(v) => (deleteOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ refs ? 'This account is in use' : `Delete ${account.name}?` }}</DialogTitle>
          <DialogDescription>
            {{ refs ? `${refs} record${refs === 1 ? ' uses' : 's use'} this account, so it cannot be deleted. Archive it instead: it disappears from the pickers and keeps its history.` : 'Nothing uses this account, so it can be deleted. You can undo this right after.' }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="deleteOpen = false">Cancel</Button>
          <Button v-if="refs && !account.archived" @click="toggleArchive(); deleteOpen = false">Archive instead</Button>
          <Button v-if="!refs" variant="destructive" @click="doDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
