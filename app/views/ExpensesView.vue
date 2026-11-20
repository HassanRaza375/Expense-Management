<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { Plus, Trash2, Search, Download, X, TriangleAlert, Landmark } from '@lucide/vue'
import { useExpenses } from '../composables/useExpenses.js'
import { useCategories } from '../composables/useCategories.js'
import { useSettings } from '../composables/useSettings.js'
import { useBills, useConnections } from '../composables/useBills.js'
import { useAccounts } from '../composables/useAccounts.js'
import { assignmentPlan, accountPickerChoices } from '../utils/accountsView.js'
import { saveSnapshot } from '../utils/snapshots.js'
import {
  resolveFilters,
  filterTransactions,
  sortTransactions,
  groupByDay,
  summarize,
  categoryBreakdown,
  compareMonths,
  listCycles,
  currentCycle,
  previousCycle,
  cycleLabel,
  describeFilters,
  formatDayKey,
  localDayKey,
  isRefund,
  PERIOD_LABELS,
  ACCOUNT_NONE,
} from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import { downloadTransactionsCsv } from '../utils/csvExport.js'
import ExpenseFormModal from '../components/ExpenseFormModal.vue'
import ExpenseRow from '../components/ExpenseRow.vue'
import StatCard from '../components/StatCard.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Checkbox } from '@/components/ui/checkbox/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const { expenses, addExpense, updateExpense, deleteExpense, undoDelete, duplicateExpense, deleteMany, restoreMany, applyAccountChanges, undoAssignAccount, addReceipt } = useExpenses()
const { store: accountStore } = useAccounts()
const { sorted, findById: findCategory } = useCategories()
const { settings, setLastCategoryId } = useSettings()
const { linkedBillFor, unlinkExpenses, restoreLinks } = useBills()
const { findConnection } = useConnections()

// ---- "now" (refreshed when the tab regains focus, so a page left open overnight stays correct)
const now = ref(new Date())
function refreshNow() {
  now.value = new Date()
}
onMounted(() => {
  window.addEventListener('focus', refreshNow)
  document.addEventListener('visibilitychange', refreshNow)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshNow)
  document.removeEventListener('visibilitychange', refreshNow)
})

const resetDay = computed(() => {
  const n = Math.trunc(Number(settings.cycleResetDay))
  return n >= 1 && n <= 31 ? n : 6
})

// ---- filter state. Default = All time + Current cycle (what the page showed before: "This cycle")
const period = ref('all')
const customStart = ref('')
const customEnd = ref('')
// A link such as /expenses?account=none&cycle=all (the Accounts page's "Review expenses") pre-sets these two filters.
const route = useRoute()
const cycleChoice = ref(route.query.cycle === 'all' ? 'all' : 'current') // 'all' | 'current' | 'previous' | 'c:<startKey>'
const categoryId = ref('all')
const accountFilter = ref(typeof route.query.account === 'string' && route.query.account ? route.query.account : 'all') // 'all' | ACCOUNT_NONE (Unassigned) | an account id (only offered once an account exists)
const sortMode = ref('newest')
const query = ref('')

const PERIOD_ORDER = ['this-month', 'last-month', 'this-week', 'last-week', 'this-year', 'previous-year', 'all', 'custom']
const SORT_LABELS = { newest: 'Newest first', oldest: 'Oldest first', highest: 'Highest amount', lowest: 'Lowest amount' }

const categoryNames = computed(() => Object.fromEntries(sorted().map((c) => [c.id, c.name])))

// ---- accounts (Phase 2.4). Everything is hidden until the first account exists, so the page is unchanged without accounts.
const hasAccounts = computed(() => accountStore.accounts.length > 0)
const accountNames = computed(() => Object.fromEntries(accountStore.accounts.map((a) => [a.id, a.name])))
const knownAccountIds = computed(() => accountStore.accounts.map((a) => a.id))
const accountLabel = (e) => (e?.accountId ? accountNames.value[e.accountId] || '' : '')
const accountFilterLabel = computed(() =>
  accountFilter.value === 'all' ? 'All accounts' : accountFilter.value === ACCOUNT_NONE ? 'Unassigned' : accountNames.value[accountFilter.value] || 'Unknown account'
)

function categoryFor(id) {
  return findCategory(id) || { name: 'Deleted category', icon: '❓', color: '#8FA0AC' }
}

const cycles = computed(() => listCycles(expenses, resetDay.value, now.value))
const cycleOptions = computed(() => {
  const cur = currentCycle(now.value, resetDay.value)
  const prev = previousCycle(now.value, resetDay.value)
  return [
    { value: 'all', label: 'All cycles' },
    { value: 'current', label: `Current cycle · ${cycleLabel(cur)}` },
    { value: 'previous', label: `Previous cycle · ${cycleLabel(prev)}` },
    ...cycles.value.map((c) => ({ value: `c:${c.startKey}`, label: `${cycleLabel(c)}${c.isCurrent ? ' (current)' : ''} · ${c.count}` })),
  ]
})
const cycleChoiceLabel = computed(() => cycleOptions.value.find((o) => o.value === cycleChoice.value)?.label || 'All cycles')

const cycleSelection = computed(() => {
  const v = cycleChoice.value
  if (v === 'all' || v === 'current' || v === 'previous') return v
  const found = cycles.value.find((c) => `c:${c.startKey}` === v)
  return found ? { startKey: found.startKey, endKey: found.endKey } : 'all'
})
const periodSelection = computed(() => (period.value === 'custom' ? { id: 'custom', start: customStart.value, end: customEnd.value } : period.value))

// All date logic lives in reporting.js. If it ever rejects the inputs we show the error and fall back to everything.
const filterError = ref('')
const resolved = computed(() => {
  filterError.value = ''
  try {
    return resolveFilters({ period: periodSelection.value, cycle: cycleSelection.value, now: now.value, resetDay: resetDay.value })
  } catch (err) {
    filterError.value = err?.message || 'Invalid filter'
    return resolveFilters({ now: now.value })
  }
})

const filtered = computed(() =>
  filterError.value
    ? expenses.slice()
    : filterTransactions(expenses, {
        period: periodSelection.value,
        cycle: cycleSelection.value,
        categoryId: categoryId.value,
        query: query.value,
        categoryNames: categoryNames.value,
        accountId: accountFilter.value,
        knownAccountIds: knownAccountIds.value,
        now: now.value,
        resetDay: resetDay.value,
      })
)

const byDate = computed(() => sortMode.value === 'newest' || sortMode.value === 'oldest')
const groups = computed(() => (byDate.value ? groupByDay(filtered.value, { order: sortMode.value }) : []))
const flat = computed(() => (byDate.value ? [] : sortTransactions(filtered.value, sortMode.value)))
const exportOrder = computed(() => sortTransactions(filtered.value, sortMode.value))

const summary = computed(() => summarize(filtered.value, { range: resolved.value, now: now.value }))
const topCategory = computed(() => categoryBreakdown(filtered.value).find((c) => c.net > 0) || null)

// Calendar-month comparison: only the category/search filters apply (not period or cycle).
const monthly = computed(() =>
  compareMonths(
    filterTransactions(expenses, { categoryId: categoryId.value, query: query.value, categoryNames: categoryNames.value, accountId: accountFilter.value, knownAccountIds: knownAccountIds.value, now: now.value }),
    { now: now.value }
  )
)

const description = computed(() =>
  describeFilters(resolved.value, {
    period: periodSelection.value,
    cycle: cycleSelection.value,
    categoryId: categoryId.value,
    query: query.value,
    categoryLabel: categoryId.value !== 'all' ? categoryFor(categoryId.value).name : null,
  })
)
const hasActiveFilters = computed(() => description.value.parts.length > 0 || accountFilter.value !== 'all')

function clearFilters() {
  period.value = 'all'
  customStart.value = ''
  customEnd.value = ''
  cycleChoice.value = 'all'
  categoryId.value = 'all'
  accountFilter.value = 'all'
  query.value = ''
}

// ---- paging (keeps the page quick with thousands of rows)
const PAGE = 150
const limit = ref(PAGE)
const visibleGroups = computed(() => {
  const out = []
  let n = 0
  for (const g of groups.value) {
    if (n >= limit.value) break
    out.push(g)
    n += g.items.length
  }
  return out
})
const visibleFlat = computed(() => flat.value.slice(0, limit.value))
const shownCount = computed(() => (byDate.value ? visibleGroups.value.reduce((n, g) => n + g.items.length, 0) : visibleFlat.value.length))

// ---- selection (cleared whenever the list changes under it)
const selectedIds = ref(new Set())
watch([period, customStart, customEnd, cycleChoice, categoryId, accountFilter, query, sortMode], () => {
  selectedIds.value = new Set()
  limit.value = PAGE
})
watch(filtered, (list) => {
  const visible = new Set(list.map((e) => e.id))
  const keep = [...selectedIds.value].filter((id) => visible.has(id))
  if (keep.length !== selectedIds.value.size) selectedIds.value = new Set(keep)
})
const allSelected = computed(() => filtered.value.length > 0 && selectedIds.value.size === filtered.value.length)
function toggleSelect(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function toggleSelectAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(filtered.value.map((e) => e.id))
}

// ---- add / edit
const modalOpen = ref(false)
const editingExpense = ref(null)

function openAdd() {
  editingExpense.value = null
  modalOpen.value = true
}
function openEdit(exp) {
  editingExpense.value = exp
  modalOpen.value = true
}

// Receipt files picked while adding an expense are saved right after it exists; a failure is reported but never blocks the expense.
async function attachStaged(expenseId, files) {
  let saved = 0
  for (const file of files) {
    try {
      await addReceipt(expenseId, file)
      saved++
    } catch (err) {
      toast.error(`${file.name}: ${err?.message || 'could not be saved'}`)
    }
  }
  if (saved) toast(saved === 1 ? 'Receipt attached' : `${saved} receipts attached`)
}

function handleSave(payload, { another = false } = {}) {
  const receiptFiles = payload.receiptFiles
  delete payload.receiptFiles
  try {
    if (editingExpense.value) {
      updateExpense(editingExpense.value.id, payload)
      toast(payload.kind === 'refund' ? 'Refund updated' : 'Expense updated')
    } else {
      const created = addExpense(payload)
      if (receiptFiles?.length) attachStaged(created.id, receiptFiles)
      setLastCategoryId(payload.categoryId)
      toast(payload.kind === 'refund' ? 'Refund added' : 'Expense added')
    }
  } catch (err) {
    toast.error(err?.message || 'Could not save')
    return
  }
  if (!another) modalOpen.value = false
}

// ---- duplicate
function handleDuplicate(exp) {
  const copy = duplicateExpense(exp.id)
  if (!copy) return
  toast('Duplicated as today\'s entry', { action: { label: 'Edit', onClick: () => openEdit(copy) } })
}

// ---- delete (always confirmed; Undo toast kept)
const pendingDelete = ref(null) // single expense
const bulkDeleteOpen = ref(false)

// An expense that is the payment for a bill: deleting it sends that bill back to UNPAID (Undo restores both).
const pendingBill = computed(() => (pendingDelete.value ? linkedBillFor(pendingDelete.value.id) : null))
function billLabel(bill) {
  return `${findConnection(bill.connectionId)?.connectionName || 'Bill'} · ${bill.billingMonth}`
}

function askDelete(exp) {
  pendingDelete.value = exp
}
function confirmDelete() {
  const exp = pendingDelete.value
  pendingDelete.value = null
  if (!exp) return
  const billChanges = unlinkExpenses([exp.id])
  deleteExpense(exp.id)
  toast(isRefund(exp) ? 'Refund deleted' : 'Expense deleted', {
    action: {
      label: 'Undo',
      onClick: () => {
        undoDelete()
        restoreLinks(billChanges)
      },
    },
  })
}

const selectedItems = computed(() => expenses.filter((e) => selectedIds.value.has(e.id)))
const selectedSummary = computed(() => summarize(selectedItems.value, { now: now.value }))
const selectedBillCount = computed(() => selectedItems.value.filter((e) => linkedBillFor(e.id)).length)

function confirmBulkDelete() {
  const ids = [...selectedIds.value]
  bulkDeleteOpen.value = false
  selectedIds.value = new Set()
  const billChanges = unlinkExpenses(ids)
  const removed = deleteMany(ids)
  toast(`${removed.length} transaction${removed.length === 1 ? '' : 's'} deleted`, {
    action: {
      label: 'Undo',
      onClick: () => {
        restoreMany(removed)
        restoreLinks(billChanges)
      },
    },
  })
}

// ---- bulk "Assign account": the confirmation shows the count, a safety snapshot is taken first, and Undo restores every record
const assignOpen = ref(false)
const assignTarget = ref('') // '' = remove the account
const assignChoices = computed(() => accountPickerChoices(accountStore))
const assignPlan = computed(() => assignmentPlan(expenses, [...selectedIds.value], assignTarget.value, accountStore))
const assignTargetLabel = computed(() => (assignTarget.value ? accountNames.value[assignTarget.value] || '' : 'No account'))

function openAssign() {
  assignTarget.value = assignChoices.value[0]?.id || ''
  assignOpen.value = true
}

async function confirmAssign() {
  const plan = assignPlan.value
  assignOpen.value = false
  if (!plan.count) {
    toast('Nothing to change: every selected transaction already has that account')
    return
  }
  try {
    await saveSnapshot('before-bulk-assign') // a rollback point before a bulk change
  } catch {
    if (!window.confirm('A safety snapshot could not be saved. Assign the account anyway? (Undo is still available right after.)')) return
  }
  const applied = applyAccountChanges(plan.changes)
  selectedIds.value = new Set()
  const label = assignTarget.value ? 'to ' + assignTargetLabel.value : 'cleared'
  toast('Account ' + label + ' on ' + applied.length + ' transaction' + (applied.length === 1 ? '' : 's'), {
    action: { label: 'Undo', onClick: () => undoAssignAccount(applied) },
  })
}

// ---- CSV of exactly what is on screen (filters + sort). The file is produced by the shared exporter in utils/csvExport.js.
function exportCsv() {
  const n = downloadTransactionsCsv(exportOrder.value, { categoryNames: categoryNames.value, accountNames: accountNames.value, now: now.value })
  toast(`Exported ${n} transaction${n === 1 ? '' : 's'}`)
}

// ---- small display helpers (formatting only; no date logic)
const money = (n) => formatCurrency(n, settings.currencySymbol).replace(/^-/, '−')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const dayText = (date) => (localDayKey(date) ? formatDayKey(localDayKey(date)) : 'Date unreadable')
function signedPct(p) {
  return p === null ? null : `${p > 0 ? '+' : ''}${p.toFixed(0)}%`
}
function changeWords(c) {
  if (c.change === 0) return 'the same as'
  return `${money(Math.abs(c.change))} ${c.change > 0 ? 'higher than' : 'lower than'}`
}
const monthStatus = (c) => (c.change > 0 ? 'warn' : c.change < 0 ? 'good' : 'default')
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <!-- Summary -->
    <section class="flex min-w-0 flex-col gap-3" aria-label="Summary">
      <Card>
        <CardContent class="flex flex-col gap-3 p-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net spent</div>
              <div class="amount text-3xl font-semibold" :class="summary.net < 0 ? 'text-status-good' : ''" data-testid="net-spent">{{ money(summary.net) }}</div>
            </div>
            <Button class="w-full sm:w-auto" data-testid="add-expense" @click="openAdd"><Plus class="h-4 w-4" /> Add expense</Button>
          </div>
          <div class="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">Spent (gross)</div>
              <div class="amount font-medium" data-testid="gross">{{ money(summary.gross) }}</div>
              <div class="text-xs text-muted-foreground">{{ plural(summary.expenseCount, 'expense') }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Refunds</div>
              <div class="amount font-medium" :class="summary.refunds > 0 ? 'text-status-good' : ''" data-testid="refunds">
                {{ summary.refunds > 0 ? '−' + money(summary.refunds) : money(0) }}
              </div>
              <div class="text-xs text-muted-foreground">{{ plural(summary.refundCount, 'refund') }}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Transactions" :value="String(summary.count)" :sub="summary.refundCount ? `${plural(summary.expenseCount, 'expense')} · ${plural(summary.refundCount, 'refund')}` : ''" />
        <StatCard label="Avg / active day" :value="money(Math.round(summary.averagePerActiveDay))" :sub="plural(summary.activeDays, 'active day')" />
        <StatCard
          label="Largest expense"
          :value="summary.largest ? money(summary.largest.amount) : '—'"
          :sub="summary.largest ? `${summary.largest.note || categoryFor(summary.largest.categoryId).name} · ${dayText(summary.largest.date)}` : ''"
        />
        <StatCard
          label="Top category"
          :value="topCategory ? categoryFor(topCategory.categoryId).name : '—'"
          :sub="topCategory ? `${money(topCategory.net)} · ${topCategory.share.toFixed(0)}%` : ''"
        />
      </div>

      <Card>
        <CardContent class="flex flex-col gap-3 p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 class="m-0 text-sm font-semibold">This month vs last month</h2>
            <span class="text-xs text-muted-foreground">Calendar months. The period and cycle filters don't apply.</span>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="month-compare">
            <div class="flex min-w-0 flex-col gap-1">
              <div class="text-xs text-muted-foreground">
                Month to date · day 1–{{ monthly.daysElapsed }} vs day 1–{{ monthly.previousSpanDays }} of last month
                <span v-if="monthly.previousSpanClamped">(last month was shorter)</span>
              </div>
              <div class="amount text-xl font-semibold">{{ money(monthly.monthToDate.current) }}</div>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <Badge :variant="monthStatus(monthly.monthToDate)">
                  {{ monthly.monthToDate.change > 0 ? '▲' : monthly.monthToDate.change < 0 ? '▼' : '=' }}
                  {{ signedPct(monthly.monthToDate.changePct) ?? 'no % (nothing to compare)' }}
                </Badge>
                <span class="text-muted-foreground">{{ changeWords(monthly.monthToDate) }} {{ money(monthly.monthToDate.previous) }} last month</span>
              </div>
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <div class="text-xs text-muted-foreground">
                Full month · so far vs all of last month
                <span v-if="!monthly.fullMonth.currentIsComplete">(this month isn't over yet)</span>
              </div>
              <div class="amount text-xl font-semibold">{{ money(monthly.fullMonth.current) }}</div>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <Badge :variant="monthStatus(monthly.fullMonth)">
                  {{ monthly.fullMonth.change > 0 ? '▲' : monthly.fullMonth.change < 0 ? '▼' : '=' }}
                  {{ signedPct(monthly.fullMonth.changePct) ?? 'no % (nothing to compare)' }}
                </Badge>
                <span class="text-muted-foreground">{{ changeWords(monthly.fullMonth) }} {{ money(monthly.fullMonth.previous) }} last month</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>

    <!-- Filters -->
    <Card>
      <CardContent class="flex flex-col gap-3 p-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="flex min-w-0 flex-col gap-1.5">
            <Label>Period</Label>
            <Select v-model="period">
              <SelectTrigger data-testid="period-select"><SelectValue>{{ PERIOD_LABELS[period] }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="id in PERIOD_ORDER" :key="id" :value="id">{{ PERIOD_LABELS[id] }}</SelectItem>
              </SelectContent>
            </Select>
            <div v-if="period === 'custom'" class="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <div class="flex min-w-0 flex-col gap-1">
                <Label for="range-from" class="text-xs text-muted-foreground">From</Label>
                <Input id="range-from" v-model="customStart" type="date" data-testid="custom-from" />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <Label for="range-to" class="text-xs text-muted-foreground">To (included)</Label>
                <Input id="range-to" v-model="customEnd" type="date" data-testid="custom-to" />
              </div>
            </div>
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <Label>Budget cycle</Label>
            <Select v-model="cycleChoice">
              <SelectTrigger data-testid="cycle-select"><SelectValue>{{ cycleChoiceLabel }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in cycleOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <Label>Category</Label>
            <Select v-model="categoryId">
              <SelectTrigger data-testid="category-select">
                <SelectValue>{{ categoryId === 'all' ? 'All categories' : `${categoryFor(categoryId).icon} ${categoryFor(categoryId).name}` }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem v-for="cat in sorted()" :key="cat.id" :value="cat.id">{{ cat.icon }} {{ cat.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="hasAccounts" class="flex min-w-0 flex-col gap-1.5">
            <Label>Account</Label>
            <Select v-model="accountFilter">
              <SelectTrigger data-testid="account-select"><SelectValue>{{ accountFilterLabel }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                <SelectItem :value="ACCOUNT_NONE">Unassigned</SelectItem>
                <SelectItem v-for="a in accountStore.accounts" :key="a.id" :value="a.id">{{ a.name }}{{ a.archived ? ' (archived)' : '' }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <Label>Sort</Label>
            <Select v-model="sortMode">
              <SelectTrigger data-testid="sort-select"><SelectValue>{{ SORT_LABELS[sortMode] }}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in SORT_LABELS" :key="key" :value="key">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="relative">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="query" type="search" placeholder="Search notes and categories…" class="pl-8" data-testid="search" />
        </div>

        <div class="flex flex-col gap-2 border-t border-border pt-3" data-testid="active-filters">
          <p class="m-0 text-sm" aria-live="polite">
            <span class="font-medium">{{ description.sentence }}</span>
            <span class="text-muted-foreground"> · {{ filtered.length }} transaction{{ filtered.length === 1 ? '' : 's' }}</span>
          </p>
          <p v-if="filterError" class="m-0 flex items-center gap-1.5 text-sm text-destructive" role="alert"><TriangleAlert class="h-4 w-4" /> {{ filterError }}. Showing everything.</p>
          <div class="flex flex-wrap items-center gap-2">
            <Badge v-for="part in description.parts" :key="part" variant="secondary" class="max-w-full truncate">{{ part }}</Badge>
            <Badge v-if="accountFilter !== 'all'" variant="secondary" class="max-w-full truncate" data-testid="account-filter-badge">Account: {{ accountFilterLabel }}</Badge>
            <Button v-if="hasActiveFilters" variant="ghost" size="sm" @click="clearFilters"><X class="h-4 w-4" /> Clear filters</Button>
            <Button class="ml-auto" variant="outline" size="sm" :disabled="!filtered.length" data-testid="export-csv" @click="exportCsv">
              <Download class="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Bulk selection -->
    <Card v-if="filtered.length">
      <CardContent class="flex flex-wrap items-center justify-between gap-2 p-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox :model-value="allSelected" aria-label="Select all shown" data-testid="select-all" @update:model-value="toggleSelectAll" />
          {{ selectedIds.size ? `${selectedIds.size} selected` : `Select all ${filtered.length}` }}
        </label>
        <div v-if="selectedIds.size" class="flex flex-wrap items-center gap-2">
          <Button v-if="hasAccounts" variant="outline" size="sm" data-testid="bulk-assign" @click="openAssign">
            <Landmark class="h-4 w-4" /> Assign account
          </Button>
          <Button variant="destructive" size="sm" data-testid="bulk-delete" @click="bulkDeleteOpen = true">
            <Trash2 class="h-4 w-4" /> Delete {{ selectedIds.size }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Empty states -->
    <Card v-if="!expenses.length">
      <CardContent class="flex flex-col items-center gap-3 p-10 text-center">
        <h2 class="m-0 text-lg">No expenses yet</h2>
        <p class="m-0 text-sm text-muted-foreground">Add your first expense to start tracking.</p>
        <Button @click="openAdd"><Plus class="h-4 w-4" /> Add an expense</Button>
      </CardContent>
    </Card>
    <Card v-else-if="!filtered.length">
      <CardContent class="flex flex-col items-center gap-3 p-8 text-center">
        <p class="m-0 text-muted-foreground">No transactions match these filters.</p>
        <Button v-if="hasActiveFilters" variant="outline" size="sm" @click="clearFilters">Clear filters</Button>
      </CardContent>
    </Card>

    <!-- Grouped by local day (newest / oldest) -->
    <template v-if="byDate">
      <div v-for="group in visibleGroups" :key="group.dayKey ?? 'unknown'" class="flex flex-col gap-2" data-testid="day-group">
        <div class="flex items-baseline justify-between gap-2 px-1 text-sm text-muted-foreground">
          <span>{{ group.dayKey ? formatDayKey(group.dayKey, { weekday: true }) : 'Date unreadable' }}</span>
          <span class="amount whitespace-nowrap" data-testid="day-total"><span class="sr-only">Day total </span>{{ money(group.net) }}</span>
        </div>
        <Card class="overflow-hidden py-0">
          <ExpenseRow
            v-for="exp in group.items"
            :key="exp.id"
            :expense="exp"
            :category-name="categoryFor(exp.categoryId).name"
            :category-icon="categoryFor(exp.categoryId).icon"
            :account-name="accountLabel(exp)"
            :amount-text="money(exp.amount)"
            :selected="selectedIds.has(exp.id)"
            @toggle="toggleSelect(exp.id)"
            @edit="openEdit(exp)"
            @duplicate="handleDuplicate(exp)"
            @delete="askDelete(exp)"
          />
        </Card>
      </div>
    </template>

    <!-- Sorted by amount: one flat list, each row shows its own date -->
    <template v-else-if="visibleFlat.length">
      <p class="m-0 px-1 text-xs text-muted-foreground">Sorted by amount, so days are not grouped.</p>
      <Card class="overflow-hidden py-0">
        <ExpenseRow
          v-for="exp in visibleFlat"
          :key="exp.id"
          :expense="exp"
          :category-name="categoryFor(exp.categoryId).name"
          :category-icon="categoryFor(exp.categoryId).icon"
          :account-name="accountLabel(exp)"
          :amount-text="money(exp.amount)"
          :date-text="dayText(exp.date)"
          :selected="selectedIds.has(exp.id)"
          @toggle="toggleSelect(exp.id)"
          @edit="openEdit(exp)"
          @duplicate="handleDuplicate(exp)"
          @delete="askDelete(exp)"
        />
      </Card>
    </template>

    <div v-if="filtered.length > shownCount" class="flex flex-col items-center gap-1">
      <Button variant="outline" data-testid="show-more" @click="limit += PAGE">Show more</Button>
      <span class="text-xs text-muted-foreground">Showing {{ shownCount }} of {{ filtered.length }}</span>
    </div>

    <ExpenseFormModal :open="modalOpen" :expense="editingExpense" @close="modalOpen = false" @save="handleSave" />

    <!-- Confirm: delete one -->
    <Dialog :open="!!pendingDelete" @update:open="(v) => !v && (pendingDelete = null)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete this {{ pendingDelete && isRefund(pendingDelete) ? 'refund' : 'expense' }}?</DialogTitle>
          <DialogDescription v-if="pendingDelete">
            {{ pendingDelete.note || categoryFor(pendingDelete.categoryId).name }} ·
            {{ pendingDelete && isRefund(pendingDelete) ? '−' : '' }}{{ money(pendingDelete.amount) }} ·
            {{ dayText(pendingDelete.date) }}
          </DialogDescription>
        </DialogHeader>
        <p v-if="pendingBill" class="m-0 flex gap-2 text-sm" data-testid="bill-warning">
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-status-warn" />
          <span>This is the payment for the bill "{{ billLabel(pendingBill) }}". Deleting it marks that bill as <strong>unpaid</strong> again, so you can pay it again.</span>
        </p>
        <DialogFooter>
          <Button variant="ghost" @click="pendingDelete = null">Cancel</Button>
          <Button variant="destructive" data-testid="confirm-delete" @click="confirmDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Assign an account to the selected transactions -->
    <Dialog :open="assignOpen" @update:open="(v) => (assignOpen = v)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign an account to {{ selectedIds.size }} transaction{{ selectedIds.size === 1 ? '' : 's' }}</DialogTitle>
          <DialogDescription>Choose the account these transactions belong to. A safety snapshot is saved first and you can undo right after.</DialogDescription>
        </DialogHeader>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Account to assign">
          <Button v-for="a in assignChoices" :key="a.id" type="button" size="sm" :variant="assignTarget === a.id ? 'default' : 'outline'" :aria-pressed="assignTarget === a.id" :data-testid="'assign-' + a.id" @click="assignTarget = a.id">{{ a.name }}</Button>
          <Button type="button" size="sm" :variant="assignTarget === '' ? 'default' : 'outline'" :aria-pressed="assignTarget === ''" data-testid="assign-none" @click="assignTarget = ''">No account</Button>
        </div>
        <p class="m-0 text-sm text-muted-foreground" data-testid="assign-summary">
          {{ assignPlan.count }} will change{{ assignPlan.unchanged ? ', ' + assignPlan.unchanged + (assignPlan.unchanged === 1 ? ' already has' : ' already have') + ' that account' : '' }}.
          Account balances change; your spending totals and budget do not.
        </p>
        <DialogFooter>
          <Button variant="ghost" @click="assignOpen = false">Cancel</Button>
          <Button :disabled="!assignPlan.count" data-testid="confirm-assign" @click="confirmAssign">{{ assignTarget ? 'Assign to ' + assignTargetLabel : 'Remove account' }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Confirm: delete many -->
    <Dialog :open="bulkDeleteOpen" @update:open="(v) => (bulkDeleteOpen = v)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {{ selectedIds.size }} transaction{{ selectedIds.size === 1 ? '' : 's' }}?</DialogTitle>
          <DialogDescription>
            Net amount removed from your spending: {{ money(selectedSummary.net) }}. You can undo right after.
          </DialogDescription>
        </DialogHeader>
        <p v-if="selectedBillCount" class="m-0 flex gap-2 text-sm">
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-status-warn" />
          <span>{{ selectedBillCount }} of these {{ selectedBillCount === 1 ? 'is' : 'are' }} bill payments. {{ selectedBillCount === 1 ? 'That bill' : 'Those bills' }} will be marked <strong>unpaid</strong> again.</span>
        </p>
        <DialogFooter>
          <Button variant="ghost" @click="bulkDeleteOpen = false">Cancel</Button>
          <Button variant="destructive" data-testid="confirm-bulk-delete" @click="confirmBulkDelete">Delete {{ selectedIds.size }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
