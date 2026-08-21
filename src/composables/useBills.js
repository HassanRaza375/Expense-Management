import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { putAttachment, deleteAttachment } from '../utils/attachments.js'
import { useExpenses } from './useExpenses.js'
import { useCategories } from './useCategories.js'
import { useMeterReadings } from './useMeterReadings.js'
import { startOfDay } from '../utils/date.js'

export const BILL_TYPES = [
  { value: 'electricity', label: 'Electricity' },
  { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Water' },
  { value: 'internet', label: 'Internet' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'rent', label: 'Rent' },
  { value: 'other', label: 'Other' },
]

export const METERED_BILL_TYPES = ['electricity', 'gas', 'water']
export const MAX_ELECTRICITY_CONNECTIONS = 2

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'easypaisa', label: 'Easypaisa' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
]

export const BILL_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting', label: 'Awaiting Bill' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const ATTACHMENT_KINDS = [
  { value: 'billFront', label: 'Bill Front' },
  { value: 'billBack', label: 'Bill Back' },
  { value: 'pdf', label: 'PDF Bill' },
  { value: 'receipt', label: 'Payment Receipt' },
]

function defaultState() {
  return { connections: [], bills: [] }
}

const state = reactive(get(STORAGE_KEYS.BILLS, defaultState()))
if (!state.connections) state.connections = []
if (!state.bills) state.bills = []

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.BILLS, val)
  },
  { deep: true }
)

// ---------- Connection profiles ----------

export function useConnections() {
  function findConnection(id) {
    return state.connections.find((c) => c.id === id)
  }

  function electricityCount(excludeId = null) {
    return state.connections.filter((c) => c.billType === 'electricity' && c.id !== excludeId).length
  }

  function meteredConnections() {
    return state.connections.filter((c) => METERED_BILL_TYPES.includes(c.billType))
  }

  function addConnection({ connectionName, provider, billType, consumerNumber, referenceNumber, accountNumber, meterNumber }) {
    if (!connectionName || !connectionName.trim()) throw new Error('Connection name is required')
    if (!billType) throw new Error('Bill type is required')
    if (billType === 'electricity' && electricityCount() >= MAX_ELECTRICITY_CONNECTIONS) {
      throw new Error(`Only ${MAX_ELECTRICITY_CONNECTIONS} electricity meters are supported`)
    }
    const connection = {
      id: generateId(),
      connectionName: connectionName.trim(),
      provider: provider || '',
      billType,
      consumerNumber: consumerNumber || '',
      referenceNumber: referenceNumber || '',
      accountNumber: accountNumber || '',
      meterNumber: meterNumber || '',
      active: true,
      createdAt: new Date().toISOString(),
    }
    state.connections.push(connection)
    return connection
  }

  function updateConnection(id, patch) {
    const conn = findConnection(id)
    if (!conn) return
    if (patch.billType && patch.billType === 'electricity' && conn.billType !== 'electricity' && electricityCount(id) >= MAX_ELECTRICITY_CONNECTIONS) {
      throw new Error(`Only ${MAX_ELECTRICITY_CONNECTIONS} electricity meters are supported`)
    }
    Object.assign(conn, patch)
  }

  function toggleActive(id) {
    const conn = findConnection(id)
    if (conn) conn.active = !conn.active
  }

  function canDeleteConnection(id) {
    return !state.bills.some((b) => b.connectionId === id)
  }

  function deleteConnection(id) {
    if (!canDeleteConnection(id)) {
      throw new Error('This connection has bills — delete or reassign those bills first')
    }
    const idx = state.connections.findIndex((c) => c.id === id)
    if (idx !== -1) state.connections.splice(idx, 1)
  }

  return {
    connections: state.connections,
    findConnection,
    electricityCount,
    meteredConnections,
    addConnection,
    updateConnection,
    toggleActive,
    canDeleteConnection,
    deleteConnection,
  }
}

// ---------- Bills ----------

export function useBills() {
  const { addExpense, updateExpense } = useExpenses()
  const { findById: findCategoryById } = useCategories()
  const meterReadings = useMeterReadings()

  function findBill(id) {
    return state.bills.find((b) => b.id === id)
  }

  function effectiveStatus(bill) {
    if (bill.status === 'unpaid' && bill.dueDate && startOfDay(new Date(bill.dueDate)) < startOfDay(new Date())) {
      return 'overdue'
    }
    return bill.status
  }

  function isDuplicate(connectionId, billingMonth, excludeId = null) {
    return state.bills.some((b) => b.connectionId === connectionId && b.billingMonth === billingMonth && b.id !== excludeId)
  }

  function getPreviousReading(connectionId, excludeBillId = null) {
    return meterReadings.latestReadingExcluding(connectionId, excludeBillId)?.reading ?? null
  }

  function nextInternalBillId() {
    return `BILL-${String(state.bills.length + 1).padStart(4, '0')}`
  }

  function computeUnitsUsed(previousReading, currentReading) {
    if (previousReading == null || currentReading == null) return null
    const units = Number(currentReading) - Number(previousReading)
    return Number.isFinite(units) ? units : null
  }

  function addBill(payload) {
    const { connectionId, billingMonth, issueDate, dueDate, amount, arrears, providerBillNumber, currentReading, meterNumber, notes, status } = payload
    if (!connectionId) throw new Error('Connection is required')
    if (!billingMonth) throw new Error('Billing month is required')
    if (!dueDate) throw new Error('Due date is required')
    if (!(Number(amount) >= 0)) throw new Error('Amount must be 0 or greater')
    if (isDuplicate(connectionId, billingMonth)) {
      throw new Error('A bill already exists for this connection and billing month')
    }
    const previousReading = getPreviousReading(connectionId)
    const bill = {
      id: generateId(),
      internalBillId: nextInternalBillId(),
      providerBillNumber: providerBillNumber || '',
      connectionId,
      billingMonth,
      issueDate: issueDate || null,
      dueDate,
      amount: Number(amount),
      arrears: Number(arrears) || 0,
      status: status || 'unpaid',
      paidDate: null,
      paidBy: '',
      paymentMethod: null,
      transactionReference: '',
      linkedExpenseId: null,
      previousReading,
      currentReading: currentReading != null && currentReading !== '' ? Number(currentReading) : null,
      unitsUsed: computeUnitsUsed(previousReading, currentReading),
      meterNumber: meterNumber || '',
      attachments: [],
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }
    state.bills.push(bill)
    if (bill.currentReading != null) meterReadings.syncFromBill(bill)
    return bill
  }

  function updateBill(id, patch) {
    const bill = findBill(id)
    if (!bill) return
    if ((patch.connectionId || patch.billingMonth) && isDuplicate(patch.connectionId ?? bill.connectionId, patch.billingMonth ?? bill.billingMonth, id)) {
      throw new Error('A bill already exists for this connection and billing month')
    }
    Object.assign(bill, patch)
    if (patch.currentReading !== undefined) {
      bill.currentReading = patch.currentReading !== '' && patch.currentReading != null ? Number(patch.currentReading) : null
      bill.previousReading = getPreviousReading(bill.connectionId, bill.id)
      bill.unitsUsed = computeUnitsUsed(bill.previousReading, bill.currentReading)
      if (bill.currentReading != null) {
        meterReadings.syncFromBill(bill)
      } else {
        meterReadings.removeByBillId(bill.id)
      }
    }
    if (patch.amount !== undefined) {
      bill.amount = Number(patch.amount)
      if (bill.status === 'paid' && bill.linkedExpenseId) {
        updateExpense(bill.linkedExpenseId, { amount: bill.amount })
      }
    }
  }

  function deleteBill(id) {
    const bill = findBill(id)
    if (!bill) return
    for (const att of bill.attachments) {
      deleteAttachment(att.id).catch(() => {})
    }
    meterReadings.removeByBillId(bill.id)
    const idx = state.bills.findIndex((b) => b.id === id)
    if (idx !== -1) state.bills.splice(idx, 1)
  }

  function markPaid(id, { paidDate, paidBy, paymentMethod, transactionReference, categoryId }) {
    const bill = findBill(id)
    if (!bill) return
    const category = findCategoryById(categoryId)
    const { findConnection } = useConnections()
    const connection = findConnection(bill.connectionId)
    const total = bill.amount + (bill.arrears || 0)

    if (bill.linkedExpenseId) {
      updateExpense(bill.linkedExpenseId, { amount: total, categoryId: category?.id })
    } else {
      const expense = addExpense({
        date: paidDate ? new Date(paidDate).toISOString() : new Date().toISOString(),
        amount: total,
        categoryId: category?.id,
        note: `${connection?.connectionName || 'Bill'} — ${bill.billingMonth}`,
        source: 'bill',
        billId: bill.id,
      })
      bill.linkedExpenseId = expense.id
    }

    bill.status = 'paid'
    bill.paidDate = paidDate || new Date().toISOString()
    bill.paidBy = paidBy || ''
    bill.paymentMethod = paymentMethod || null
    bill.transactionReference = transactionReference || ''
  }

  async function addAttachment(bill, file, kind) {
    const id = generateId()
    await putAttachment({ id, billId: bill.id, kind, filename: file.name, mimeType: file.type, size: file.size, blob: file })
    bill.attachments.push({ id, kind, filename: file.name, mimeType: file.type, size: file.size })
  }

  async function removeAttachment(bill, attachmentId) {
    await deleteAttachment(attachmentId).catch(() => {})
    bill.attachments = bill.attachments.filter((a) => a.id !== attachmentId)
  }

  function sortedByDueDate() {
    return [...state.bills].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
  }

  // ---- Dashboard ----

  function outstandingAmount() {
    return state.bills
      .filter((b) => ['unpaid', 'awaiting'].includes(b.status))
      .reduce((sum, b) => sum + b.amount + (b.arrears || 0), 0)
  }

  function billsDueThisMonth() {
    const now = new Date()
    return state.bills.filter((b) => {
      if (b.status === 'paid' || b.status === 'cancelled') return false
      const due = new Date(b.dueDate)
      return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth()
    })
  }

  function paidThisMonth() {
    const now = new Date()
    return state.bills
      .filter((b) => b.status === 'paid' && b.paidDate)
      .filter((b) => {
        const paid = new Date(b.paidDate)
        return paid.getFullYear() === now.getFullYear() && paid.getMonth() === now.getMonth()
      })
      .reduce((sum, b) => sum + b.amount + (b.arrears || 0), 0)
  }

  function unpaidCount() {
    return state.bills.filter((b) => effectiveStatus(b) === 'unpaid').length
  }

  function overdueCount() {
    return state.bills.filter((b) => effectiveStatus(b) === 'overdue').length
  }

  function recentBills(n = 5) {
    return [...state.bills].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, n)
  }

  // ---- Analytics ----

  function paidBills() {
    return state.bills.filter((b) => b.status === 'paid')
  }

  function highestBill() {
    return paidBills().reduce((max, b) => (b.amount > (max?.amount ?? -1) ? b : max), null)
  }

  function averageBill() {
    const paid = paidBills()
    if (!paid.length) return 0
    return paid.reduce((sum, b) => sum + b.amount, 0) / paid.length
  }

  function spendingByType() {
    const totals = {}
    for (const b of paidBills()) {
      const conn = state.connections.find((c) => c.id === b.connectionId)
      const type = conn?.billType || 'other'
      totals[type] = (totals[type] || 0) + b.amount + (b.arrears || 0)
    }
    return Object.entries(totals).map(([type, total]) => ({
      type,
      label: BILL_TYPES.find((t) => t.value === type)?.label || type,
      total,
    }))
  }

  function monthlySpending(monthsBack = 6) {
    const now = new Date()
    const months = []
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, date: d })
    }
    return months.map(({ key, date }) => {
      const total = paidBills()
        .filter((b) => b.paidDate && new Date(b.paidDate).getFullYear() === date.getFullYear() && new Date(b.paidDate).getMonth() === date.getMonth())
        .reduce((sum, b) => sum + b.amount + (b.arrears || 0), 0)
      return { month: key, total }
    })
  }

  function monthOverMonthChange() {
    const series = monthlySpending(2)
    const [prev, curr] = series
    if (!prev || !curr) return 0
    if (prev.total === 0) return curr.total > 0 ? 100 : 0
    return ((curr.total - prev.total) / prev.total) * 100
  }

  return {
    bills: state.bills,
    findBill,
    effectiveStatus,
    isDuplicate,
    getPreviousReading,
    addBill,
    updateBill,
    deleteBill,
    markPaid,
    addAttachment,
    removeAttachment,
    sortedByDueDate,
    outstandingAmount,
    billsDueThisMonth,
    paidThisMonth,
    unpaidCount,
    overdueCount,
    recentBills,
    highestBill,
    averageBill,
    spendingByType,
    monthlySpending,
    monthOverMonthChange,
  }
}
