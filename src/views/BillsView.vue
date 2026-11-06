<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Zap,
  Flame,
  Droplet,
  Wifi,
  Smartphone,
  Home,
  FileText,
  Wallet,
  CalendarClock,
  CircleCheck,
  AlertTriangle,
  TrendingUp,
  Gauge,
} from '@lucide/vue'
import { useBills, useConnections, BILL_TYPES, BILL_STATUSES, MAX_ELECTRICITY_CONNECTIONS } from '../composables/useBills.js'
import { useMeterReadings } from '../composables/useMeterReadings.js'
import { useExpenses } from '../composables/useExpenses.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs/index.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import StatCard from '../components/StatCard.vue'
import DonutChart from '../components/DonutChart.vue'
import TrendChart from '../components/TrendChart.vue'
import BillWizard from '../components/BillWizard.vue'
import BillPaymentModal from '../components/BillPaymentModal.vue'
import ConnectionFormModal from '../components/ConnectionFormModal.vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const router = useRouter()
const settings = useSettings().settings
const bills = useBills()
const connections = useConnections()
const meterReadings = useMeterReadings()
const { findById: findExpense } = useExpenses()

const TYPE_ICONS = { electricity: Zap, gas: Flame, water: Droplet, internet: Wifi, mobile: Smartphone, rent: Home, other: FileText }
const TYPE_COLORS = { electricity: '#D6963A', gas: '#D9695F', water: '#4A9498', internet: '#5FAE86', mobile: '#8FA0AC', rent: '#2E6E72', other: '#8FA0AC' }
const STATUS_BADGE = { draft: 'secondary', awaiting: 'secondary', unpaid: 'warn', overdue: 'over', paid: 'good', cancelled: 'secondary' }

function connectionName(id) {
  return connections.findConnection(id)?.connectionName || 'Unknown'
}
function connectionType(id) {
  return connections.findConnection(id)?.billType || 'other'
}
function statusLabel(value) {
  if (value === 'overdue') return 'Overdue'
  return BILL_STATUSES.find((s) => s.value === value)?.label || value
}

// ---- Bills tab: filters ----
const filterType = ref('all')
const filterConnection = ref('all')
const filterStatus = ref('all')
const searchText = ref('')

const filteredBills = computed(() => {
  let list = bills.sortedByDueDate()
  if (filterType.value !== 'all') list = list.filter((b) => connectionType(b.connectionId) === filterType.value)
  if (filterConnection.value !== 'all') list = list.filter((b) => b.connectionId === filterConnection.value)
  if (filterStatus.value !== 'all') list = list.filter((b) => bills.effectiveStatus(b) === filterStatus.value)
  if (searchText.value.trim()) {
    const q = searchText.value.trim().toLowerCase()
    list = list.filter(
      (b) =>
        connectionName(b.connectionId).toLowerCase().includes(q) ||
        (b.providerBillNumber || '').toLowerCase().includes(q) ||
        (b.notes || '').toLowerCase().includes(q)
    )
  }
  return list
})

// ---- Wizard / payment / connection modal state ----
const wizardOpen = ref(false)
const editingBill = ref(null)
function openAddBill() {
  if (!connections.connections.length) {
    toast.error('Add a connection first')
    return
  }
  editingBill.value = null
  wizardOpen.value = true
}
function openEditBill(bill) {
  editingBill.value = bill
  wizardOpen.value = true
}

const paymentOpen = ref(false)
const payingBill = ref(null)
function openMarkPaid(bill) {
  payingBill.value = bill
  paymentOpen.value = true
}
function handlePaid() {
  paymentOpen.value = false
  toast('Bill marked paid — expense created')
}

// Deleting a bill always asks first and says exactly what goes with it; Undo brings everything back
// (attachments are restored from memory, so Undo works until this page is closed or reloaded).
const billToDelete = ref(null)
const deleteImpact = computed(() => {
  const b = billToDelete.value
  if (!b) return null
  return {
    files: (b.attachments || []).length,
    reading: b.currentReading != null,
    keepsExpense: !!(b.linkedExpenseId && findExpense(b.linkedExpenseId)),
  }
})

function askDeleteBill(bill) {
  billToDelete.value = bill
}

async function confirmDeleteBill() {
  const bill = billToDelete.value
  billToDelete.value = null
  if (!bill) return
  const snapshot = await bills.deleteBill(bill.id)
  if (!snapshot) return
  const name = `${connectionName(bill.connectionId)} — ${bill.billingMonth}`
  toast(`Bill deleted: ${name}`, {
    duration: 15000,
    action: {
      label: 'Undo',
      onClick: async () => {
        const { restoredFiles, failedFiles } = await bills.restoreBill(snapshot)
        if (failedFiles) toast.error(`Bill restored, but ${failedFiles} attachment${failedFiles === 1 ? '' : 's'} could not be recovered`)
        else toast(restoredFiles ? `Bill restored with ${restoredFiles} attachment${restoredFiles === 1 ? '' : 's'}` : 'Bill restored')
      },
    },
  })
}

const connectionModalOpen = ref(false)
const editingConnection = ref(null)
function openAddConnection() {
  editingConnection.value = null
  connectionModalOpen.value = true
}
function openEditConnection(conn) {
  editingConnection.value = conn
  connectionModalOpen.value = true
}
function handleDeleteConnection(conn) {
  try {
    connections.deleteConnection(conn.id)
  } catch (e) {
    toast.error(e.message)
  }
}

// ---- Analytics ----
const spendingByType = computed(() =>
  bills.spendingByType().map((s) => ({ label: s.label, value: s.total, color: TYPE_COLORS[s.type] || '#8FA0AC' }))
)
const monthlyTrend = computed(() => bills.monthlySpending(6).map((m) => ({ date: `${m.month}-01`, total: m.total })))

// ---- Meter readings ----
const meteredConnections = computed(() => connections.meteredConnections())
function latestReadingFor(connectionId) {
  return meterReadings.readingsForConnection(connectionId)[0] || null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-display text-xl">Bills</h2>
      <Button @click="openAddBill"><Plus class="h-4 w-4" /> Add bill</Button>
    </div>

    <Tabs default-value="bills">
      <TabsList>
        <TabsTrigger value="bills">Bills</TabsTrigger>
        <TabsTrigger value="connections">Connections</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
      </TabsList>

      <TabsContent value="bills" class="flex flex-col gap-4">
        <section class="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard :icon="Wallet" label="Outstanding" :value="formatCurrency(bills.outstandingAmount(), settings.currencySymbol)" />
          <StatCard :icon="CalendarClock" label="Due this month" :value="String(bills.billsDueThisMonth().length)" />
          <StatCard :icon="CircleCheck" label="Paid this month" :value="formatCurrency(bills.paidThisMonth(), settings.currencySymbol)" />
          <StatCard :icon="FileText" label="Unpaid bills" :value="String(bills.unpaidCount())" />
          <StatCard :icon="AlertTriangle" label="Overdue" :value="String(bills.overdueCount())" :status="bills.overdueCount() > 0 ? 'over' : ''" />
        </section>

        <Card>
          <CardContent class="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
            <Select v-model="filterType">
              <SelectTrigger class="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem v-for="t in BILL_TYPES" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="filterConnection">
              <SelectTrigger class="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All connections</SelectItem>
                <SelectItem v-for="c in connections.connections" :key="c.id" :value="c.id">{{ c.connectionName }}</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="filterStatus">
              <SelectTrigger class="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem v-for="s in BILL_STATUSES" :key="s.value" :value="s.value">{{ s.label }}</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Input v-model="searchText" type="text" placeholder="Search connection, bill #, notes..." class="w-full sm:w-56" />
          </CardContent>
        </Card>

        <Card v-if="!filteredBills.length">
          <CardContent class="p-8 text-center text-muted-foreground">No bills match these filters.</CardContent>
        </Card>

        <div class="flex flex-col gap-2">
          <Card v-for="bill in filteredBills" :key="bill.id">
            <CardContent class="flex flex-wrap items-center gap-3 p-4">
              <component :is="TYPE_ICONS[connectionType(bill.connectionId)]" class="h-5 w-5 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1 basis-40">
                <div class="truncate font-medium">{{ connectionName(bill.connectionId) }} — {{ bill.billingMonth }}</div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Due {{ formatDate(bill.dueDate, 'short') }}
                  <Badge :variant="STATUS_BADGE[bills.effectiveStatus(bill)]">{{ statusLabel(bills.effectiveStatus(bill)) }}</Badge>
                </div>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <div class="amount font-semibold whitespace-nowrap">{{ formatCurrency(bill.amount + (bill.arrears || 0), settings.currencySymbol) }}</div>
                <div class="flex gap-1">
                  <Button v-if="bill.status !== 'paid' && bill.status !== 'cancelled'" variant="ghost" size="icon" title="Mark paid" @click="openMarkPaid(bill)">
                    <CheckCircle2 class="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Edit" @click="openEditBill(bill)"><Pencil class="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Delete" data-testid="delete-bill" @click="askDeleteBill(bill)"><Trash2 class="h-4 w-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="connections" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <p class="text-sm text-muted-foreground">
            Electricity meters: {{ connections.electricityCount() }} / {{ MAX_ELECTRICITY_CONNECTIONS }}
          </p>
          <Button @click="openAddConnection"><Plus class="h-4 w-4" /> Add connection</Button>
        </div>

        <Card v-if="!connections.connections.length">
          <CardContent class="p-8 text-center text-muted-foreground">No connections yet. Add your electricity, gas, or internet connection to start tracking bills.</CardContent>
        </Card>

        <div class="flex flex-col gap-2">
          <Card v-for="conn in connections.connections" :key="conn.id" :class="!conn.active && 'opacity-55'">
            <CardContent class="flex flex-wrap items-center gap-3 p-4">
              <component :is="TYPE_ICONS[conn.billType]" class="h-5 w-5 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <div class="font-medium">{{ conn.connectionName }}</div>
                <div class="text-xs text-muted-foreground">{{ conn.provider }} · {{ BILL_TYPES.find((t) => t.value === conn.billType)?.label }}</div>
              </div>
              <div class="ml-auto flex gap-2">
                <Button variant="outline" size="sm" @click="connections.toggleActive(conn.id)">{{ conn.active ? 'Active' : 'Inactive' }}</Button>
                <Button variant="outline" size="sm" @click="openEditConnection(conn)">Edit</Button>
                <Button variant="destructive" size="sm" @click="handleDeleteConnection(conn)">Delete</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="analytics" class="flex flex-col gap-4">
        <section class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard :icon="TrendingUp" label="Highest bill" :value="formatCurrency(bills.highestBill()?.amount || 0, settings.currencySymbol)" />
          <StatCard label="Average bill" :value="formatCurrency(bills.averageBill(), settings.currencySymbol)" />
          <StatCard
            label="vs last month"
            :value="(bills.monthOverMonthChange() >= 0 ? '+' : '') + bills.monthOverMonthChange().toFixed(0) + '%'"
            :status="bills.monthOverMonthChange() > 0 ? 'warn' : 'good'"
          />
        </section>
        <section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardContent class="p-4">
              <h3 class="mb-3 text-sm font-semibold">Spending by type (paid)</h3>
              <DonutChart :segments="spendingByType" empty-text="No paid bills yet" />
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <h3 class="mb-3 text-sm font-semibold">Monthly spending (last 6 months)</h3>
              <TrendChart :points="monthlyTrend" />
            </CardContent>
          </Card>
        </section>

        <h3 class="mt-2 text-base font-semibold">Meter readings</h3>

        <Card v-if="!meteredConnections.length">
          <CardContent class="p-8 text-center text-muted-foreground">
            No electricity, gas, or water connections yet — add one to start tracking meter readings.
          </CardContent>
        </Card>

        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            v-for="c in meteredConnections"
            :key="c.id"
            class="cursor-pointer transition-colors hover:border-primary"
            @click="router.push('/bills/meters/' + c.id)"
          >
            <CardContent class="flex flex-col gap-2 p-4">
              <div class="flex items-center gap-2">
                <component :is="TYPE_ICONS[c.billType] || Gauge" class="h-4 w-4 text-muted-foreground" />
                <strong>{{ c.connectionName }}</strong>
              </div>
              <div class="amount text-lg font-semibold">
                {{ latestReadingFor(c.id) ? latestReadingFor(c.id).reading.toLocaleString() : '—' }}
              </div>
              <div class="text-xs text-muted-foreground">
                <span v-if="latestReadingFor(c.id)">Last read {{ formatDate(latestReadingFor(c.id).date, 'short') }}</span>
                <span v-else>No readings yet</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>

    <BillWizard :open="wizardOpen" :bill="editingBill" @close="wizardOpen = false" @saved="toast('Bill saved')" />
    <BillPaymentModal :open="paymentOpen" :bill="payingBill" @close="paymentOpen = false" @paid="handlePaid" />

    <Dialog :open="!!billToDelete" @update:open="(v) => !v && (billToDelete = null)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete this bill?</DialogTitle>
          <DialogDescription v-if="billToDelete">{{ connectionName(billToDelete.connectionId) }} — {{ billToDelete.billingMonth }}</DialogDescription>
        </DialogHeader>
        <ul v-if="deleteImpact" class="m-0 flex list-disc flex-col gap-1 pl-5 text-sm" data-testid="bill-delete-impact">
          <li v-if="deleteImpact.files">
            {{ deleteImpact.files }} attachment{{ deleteImpact.files === 1 ? '' : 's' }} (photos/PDFs) will be <strong>deleted from this device</strong>.
          </li>
          <li v-if="deleteImpact.reading">Its meter reading will be removed from the reading history.</li>
          <li v-if="deleteImpact.keepsExpense">The expense for its payment is <strong>kept</strong> in your spending, just no longer linked to a bill.</li>
          <li v-if="!deleteImpact.files && !deleteImpact.reading && !deleteImpact.keepsExpense">Nothing else is attached to it.</li>
        </ul>
        <p class="m-0 text-xs text-muted-foreground">You can Undo straight afterwards. Attachments can only be brought back until you close or reload this page.</p>
        <DialogFooter>
          <Button variant="ghost" @click="billToDelete = null">Cancel</Button>
          <Button variant="destructive" data-testid="confirm-delete-bill" @click="confirmDeleteBill">Delete bill</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConnectionFormModal :open="connectionModalOpen" :connection="editingConnection" @close="connectionModalOpen = false" @save="connectionModalOpen = false" />
  </div>
</template>
