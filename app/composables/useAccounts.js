import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { localNoonISO, isDayKey, localDayKey } from '../utils/reporting.js'
import { accountBalance, accountsOverview, accountLedger, unassignedSince, reconcileDifference, validateAccount, validateTransfer, validateAdjustment } from '../utils/accounts.js'
import { accountCards, unassignedSummary, ledgerView, reconcileView } from '../utils/accountsView.js'
import { useExpenses } from './useExpenses.js'
import { useIncome } from './useIncome.js'
import { useLending } from './useLending.js'
import { useInvestments } from './useInvestments.js'
import { useSettings } from './useSettings.js'

// One storage key holds accounts, transfers and corrections TOGETHER, so a backup/restore/snapshot can never leave
// transfers pointing at missing accounts. Absent key = no accounts. All arithmetic lives in utils/accounts.js (pure).
const raw = get(STORAGE_KEYS.ACCOUNTS, null)
const state = reactive({
  accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
  transfers: Array.isArray(raw?.transfers) ? raw.transfers : [],
  adjustments: Array.isArray(raw?.adjustments) ? raw.adjustments : [],
})

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.ACCOUNTS, val)
  },
  { deep: true }
)

let pendingUndoAccount = null
let pendingUndoTransfer = null
let pendingUndoAdjustment = null

// A picked day ('YYYY-MM-DD') is saved as local noon; a full ISO timestamp is kept as given.
function storedDate(input) {
  if (isDayKey(input)) return localNoonISO(input)
  if (localDayKey(input) !== null) return new Date(input).toISOString()
  return null
}

function fail(errors) {
  throw new Error(errors.join('. '))
}

export function useAccounts() {
  const { expenses } = useExpenses()
  const { income } = useIncome()
  const { loans } = useLending()
  const { funds } = useInvestments()
  const { settings } = useSettings()

  // Every record kind that can move money in an account (the pure maths in utils/accounts.js decides what each one does).
  const records = () => ({ expenses, income, loans, funds })
  const data = () => ({ ...records(), transfers: state.transfers, adjustments: state.adjustments })

  function findAccount(id) {
    return state.accounts.find((a) => a.id === id)
  }

  function activeAccounts() {
    return state.accounts.filter((a) => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  function addAccount({ name, type, openingBalance = 0, openingDate, notes = '' }) {
    const input = { name, type, openingBalance, openingDate }
    const errors = validateAccount(input, { accounts: state.accounts })
    if (errors.length) fail(errors)
    const account = {
      id: generateId(),
      name: String(name).trim(),
      type,
      openingBalance: Number(openingBalance),
      openingDate,
      archived: false,
      notes: notes || '',
      order: state.accounts.reduce((m, a) => Math.max(m, a.order ?? 0), -1) + 1,
      createdAt: new Date().toISOString(),
    }
    state.accounts.push(account)
    return account
  }

  function updateAccount(id, patch) {
    const account = findAccount(id)
    if (!account) return
    const merged = { name: account.name, type: account.type, openingBalance: account.openingBalance, openingDate: account.openingDate, ...patch }
    const errors = validateAccount(merged, { accounts: state.accounts, excludeId: id })
    if (errors.length) fail(errors)
    account.name = String(merged.name).trim()
    account.type = merged.type
    account.openingBalance = Number(merged.openingBalance)
    account.openingDate = merged.openingDate
    if (patch.notes !== undefined) account.notes = patch.notes
  }

  function archiveAccount(id) {
    const account = findAccount(id)
    if (account) account.archived = true
  }

  function unarchiveAccount(id) {
    const account = findAccount(id)
    if (account) account.archived = false
  }

  // How many records point at this account (expenses/refunds, income, transfers, corrections, loans and repayments).
  function referenceCount(id) {
    return (
      expenses.filter((e) => e.accountId === id).length +
      income.filter((i) => i.accountId === id).length +
      state.transfers.filter((t) => t.fromAccountId === id || t.toAccountId === id).length +
      state.adjustments.filter((a) => a.accountId === id).length +
      loans.reduce((n, l) => n + (l.accountId === id ? 1 : 0) + (Array.isArray(l.repayments) ? l.repayments.filter((r) => r.accountId === id).length : 0), 0) +
      funds.reduce((n, f) => n + (Array.isArray(f.contributions) ? f.contributions.filter((c) => c.accountId === id).length : 0) + (Array.isArray(f.withdrawals) ? f.withdrawals.filter((w) => w.accountId === id).length : 0), 0)
    )
  }

  // Delete is only allowed while nothing references the account; otherwise archive it.
  function deleteAccount(id) {
    const idx = state.accounts.findIndex((a) => a.id === id)
    if (idx === -1) return null
    const refs = referenceCount(id)
    if (refs > 0) fail([`This account is used by ${refs} record${refs === 1 ? '' : 's'}. Archive it instead of deleting it`])
    const [removed] = state.accounts.splice(idx, 1)
    pendingUndoAccount = { account: removed, index: idx }
    if (settings.defaultAccountId === id) settings.defaultAccountId = ''
    if (settings.lastAccountId === id) settings.lastAccountId = ''
    return removed
  }

  function undoDeleteAccount() {
    if (!pendingUndoAccount) return
    state.accounts.splice(Math.min(pendingUndoAccount.index, state.accounts.length), 0, pendingUndoAccount.account)
    pendingUndoAccount = null
  }

  // ---- transfers (never an expense, never income) ----
  function addTransfer({ date, amount, fromAccountId, toAccountId, note = '' }) {
    const stored = storedDate(date ?? localDayKey(new Date()))
    const errors = validateTransfer({ accounts: state.accounts }, { date: stored, amount, fromAccountId, toAccountId })
    if (errors.length) fail(errors)
    const transfer = { id: generateId(), date: stored, amount: Number(amount), fromAccountId, toAccountId, note: note || '', createdAt: new Date().toISOString() }
    state.transfers.push(transfer)
    return transfer
  }

  function updateTransfer(id, patch) {
    const t = state.transfers.find((x) => x.id === id)
    if (!t) return
    const merged = { ...t, ...patch }
    if (patch.date !== undefined) merged.date = storedDate(patch.date)
    const errors = validateTransfer({ accounts: state.accounts }, merged, { requireActive: false })
    if (errors.length) fail(errors)
    Object.assign(t, { date: merged.date, amount: Number(merged.amount), fromAccountId: merged.fromAccountId, toAccountId: merged.toAccountId, note: merged.note || '' })
  }

  function deleteTransfer(id) {
    const idx = state.transfers.findIndex((t) => t.id === id)
    if (idx === -1) return null
    const [removed] = state.transfers.splice(idx, 1)
    pendingUndoTransfer = removed
    return removed
  }

  function undoDeleteTransfer() {
    if (pendingUndoTransfer) {
      state.transfers.push(pendingUndoTransfer)
      pendingUndoTransfer = null
    }
  }

  // ---- corrections (reconciliation adjustments): visibly NOT spending or income ----
  function addAdjustment({ accountId, date, amount, reconciledTo = null, note = '' }) {
    const stored = storedDate(date ?? localDayKey(new Date()))
    const errors = validateAdjustment({ accounts: state.accounts }, { accountId, date: stored, amount })
    if (errors.length) fail(errors)
    const adjustment = { id: generateId(), accountId, date: stored, amount: Number(amount), reconciledTo: reconciledTo === null ? null : Number(reconciledTo), note: note || '', createdAt: new Date().toISOString() }
    state.adjustments.push(adjustment)
    return adjustment
  }

  function deleteAdjustment(id) {
    const idx = state.adjustments.findIndex((a) => a.id === id)
    if (idx === -1) return null
    const [removed] = state.adjustments.splice(idx, 1)
    pendingUndoAdjustment = removed
    return removed
  }

  function undoDeleteAdjustment() {
    if (pendingUndoAdjustment) {
      state.adjustments.push(pendingUndoAdjustment)
      pendingUndoAdjustment = null
    }
  }

  // ---- reading balances (all computed from raw records; nothing is stored) ----
  function balanceOf(id, opts) {
    const account = findAccount(id)
    return account ? accountBalance(account, data(), opts) : null
  }
  function overview(opts) {
    return accountsOverview(state, records(), opts)
  }
  function ledger(id, opts) {
    const account = findAccount(id)
    return account ? accountLedger(account, data(), opts) : []
  }
  function unassigned(sinceKey) {
    return unassignedSince(state, records(), sinceKey)
  }
  function reconcilePreview(id, { actual, asOf } = {}) {
    const account = findAccount(id)
    return account ? reconcileDifference(account, data(), { actual, asOf }) : null
  }

  // ---- view models for the Accounts screens (utils/accountsView.js; nothing here does money maths) ----
  function cards(opts) {
    return accountCards(state, records(), opts)
  }
  function unassignedLine(sinceKey) {
    return unassignedSummary(state, records(), sinceKey)
  }
  function ledgerFor(id, opts) {
    const account = findAccount(id)
    return account ? ledgerView(account, state, records(), opts) : null
  }
  function reconcileFor(id, opts) {
    const account = findAccount(id)
    return account ? reconcileView(account, state, records(), opts) : null
  }

  // Reconcile: compare the real balance with the computed one; if they differ, add a visible correction for the
  // difference. Returns { ...preview, adjustment } (adjustment is null when nothing needed correcting).
  function reconcile(id, { actual, asOf, note = 'Reconciliation' } = {}) {
    const preview = reconcilePreview(id, { actual, asOf })
    if (!preview) throw new Error('Account not found')
    if (!preview.needsCorrection) return { ...preview, adjustment: null }
    const adjustment = addAdjustment({ accountId: id, date: preview.asOf, amount: preview.difference, reconciledTo: preview.actual, note })
    return { ...preview, adjustment }
  }

  return {
    store: state,
    accounts: state.accounts,
    transfers: state.transfers,
    adjustments: state.adjustments,
    findAccount,
    activeAccounts,
    addAccount,
    updateAccount,
    archiveAccount,
    unarchiveAccount,
    referenceCount,
    deleteAccount,
    undoDeleteAccount,
    addTransfer,
    updateTransfer,
    deleteTransfer,
    undoDeleteTransfer,
    addAdjustment,
    deleteAdjustment,
    undoDeleteAdjustment,
    balanceOf,
    overview,
    ledger,
    unassigned,
    reconcilePreview,
    reconcile,
    records, // every record kind that can move money in an account; screens use this instead of assembling their own list
    cards,
    unassignedLine,
    ledgerFor,
    reconcileFor,
  }
}
