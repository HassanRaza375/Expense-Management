import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS, registerState } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { performance, portfolioPerformance } from '../utils/investments.js'

const state = reactive(get(STORAGE_KEYS.INVESTMENTS, []))

// lets a change that arrives from the account (account mode) reach this state without a reload
registerState(STORAGE_KEYS.INVESTMENTS, state)

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.INVESTMENTS, val)
  },
  { deep: true }
)

let pendingUndo = null

export function useInvestments() {
  function findById(id) {
    return state.find((f) => f.id === id)
  }

  function sortedContributions(fund) {
    return [...fund.contributions].sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt))
  }

  function sortedValueEntries(fund) {
    return [...fund.valueEntries].sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt))
  }

  // Gross money put in. (Withdrawals, if any, are in performance().withdrawn / netInvested.)
  function totalInvested(fund) {
    return fund.contributions.reduce((sum, c) => sum + c.amount, 0)
  }

  // All the figures for one fund (see utils/investments.js). Funds without withdrawals get exactly the numbers shown before.
  function perf(fund) {
    return performance(fund)
  }

  function sortedWithdrawals(fund) {
    return [...(fund.withdrawals || [])].sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt))
  }

  function latestValueEntry(fund) {
    return sortedValueEntries(fund)[0] || null
  }

  // Latest value entry, less anything withdrawn after it (no entry: contributions less withdrawals).
  function currentValue(fund) {
    return performance(fund).currentValue
  }

  // Total gain = realized (from withdrawals) + unrealized. With no withdrawals this is value - invested, as before.
  function profitLoss(fund) {
    return performance(fund).totalGain
  }

  function profitLossPercent(fund) {
    return performance(fund).returnPct ?? 0
  }

  // Orders two dated records chronologically. Dates are stored as date-only values, so
  // same-day records fall back to the order they were entered (createdAt).
  function compareChronological(a, b) {
    return new Date(a.date) - new Date(b.date) || new Date(a.createdAt) - new Date(b.createdAt)
  }

  // Change vs the previous value entry, with any contributions made in between backed out
  // so a top-up isn't counted as "profit." A contribution counts as "in between" when it
  // sits after the previous entry and at-or-before the latest one, so a same-day contribution
  // logged before the new value update is correctly excluded from the gain.
  function changeSinceLast(fund) {
    const entries = sortedValueEntries(fund) // newest first
    if (entries.length < 2) return null
    const [latest, previous] = entries
    const rawDelta = latest.value - previous.value
    const contributedBetween = fund.contributions
      .filter((c) => compareChronological(c, previous) > 0 && compareChronological(c, latest) <= 0)
      .reduce((sum, c) => sum + c.amount, 0)
    // money withdrawn in between left the fund, so it is not a loss either
    const withdrawnBetween = (fund.withdrawals || [])
      .filter((w) => compareChronological(w, previous) > 0 && compareChronological(w, latest) <= 0)
      .reduce((sum, w) => sum + w.amount, 0)
    return rawDelta - contributedBetween + withdrawnBetween
  }

  function addFund({ name, provider, notes }) {
    if (!name || !name.trim()) throw new Error('Fund name is required')
    const fund = {
      id: generateId(),
      name: name.trim(),
      provider: provider || '',
      notes: notes || '',
      contributions: [],
      valueEntries: [],
      createdAt: new Date().toISOString(),
    }
    state.push(fund)
    return fund
  }

  function updateFund(id, patch) {
    const fund = findById(id)
    if (!fund) return
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error('Fund name is required')
      fund.name = patch.name.trim()
    }
    if (patch.provider !== undefined) fund.provider = patch.provider
    if (patch.notes !== undefined) fund.notes = patch.notes
  }

  function deleteFund(id) {
    const idx = state.findIndex((f) => f.id === id)
    if (idx === -1) return null
    const [removed] = state.splice(idx, 1)
    pendingUndo = removed
    return removed
  }

  function undoDelete() {
    if (pendingUndo) {
      state.push(pendingUndo)
      pendingUndo = null
    }
  }

  function addContribution(fundId, { date, amount, notes, accountId }) {
    const fund = findById(fundId)
    if (!fund) throw new Error('Fund not found')
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    const contribution = {
      id: generateId(),
      date: date || new Date().toISOString(),
      amount: amt,
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }
    if (accountId) contribution.accountId = accountId // optional: the account the money left
    fund.contributions.push(contribution)
  }

  // Money taken out of the fund. The first withdrawal creates the (optional) `withdrawals` list on the fund.
  function addWithdrawal(fundId, { date, amount, notes, accountId }) {
    const fund = findById(fundId)
    if (!fund) throw new Error('Fund not found')
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    const value = performance(fund).currentValue
    if (fund.valueEntries.length || fund.contributions.length) {
      if (amt > value + 0.005) throw new Error('Cannot withdraw more than the fund is worth (' + value + ')')
    }
    const withdrawal = {
      id: generateId(),
      date: date || new Date().toISOString(),
      amount: amt,
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }
    if (accountId) withdrawal.accountId = accountId // optional: the account the money arrived in
    if (!Array.isArray(fund.withdrawals)) fund.withdrawals = []
    fund.withdrawals.push(withdrawal)
    return withdrawal
  }

  function deleteWithdrawal(fundId, withdrawalId) {
    const fund = findById(fundId)
    if (!fund || !Array.isArray(fund.withdrawals)) return
    const idx = fund.withdrawals.findIndex((w) => w.id === withdrawalId)
    if (idx !== -1) fund.withdrawals.splice(idx, 1)
  }

  function deleteContribution(fundId, contributionId) {
    const fund = findById(fundId)
    if (!fund) return
    const idx = fund.contributions.findIndex((c) => c.id === contributionId)
    if (idx !== -1) fund.contributions.splice(idx, 1)
  }

  function addValueEntry(fundId, { date, value, notes }) {
    const fund = findById(fundId)
    if (!fund) throw new Error('Fund not found')
    const val = Number(value)
    if (!(val >= 0)) throw new Error('Value must be 0 or greater')
    fund.valueEntries.push({
      id: generateId(),
      date: date || new Date().toISOString(),
      value: val,
      notes: notes || '',
      createdAt: new Date().toISOString(),
    })
  }

  function updateValueEntry(fundId, entryId, patch) {
    const fund = findById(fundId)
    if (!fund) return
    const entry = fund.valueEntries.find((e) => e.id === entryId)
    if (!entry) return
    if (patch.date !== undefined) entry.date = patch.date
    if (patch.value !== undefined) {
      const val = Number(patch.value)
      if (!(val >= 0)) throw new Error('Value must be 0 or greater')
      entry.value = val
    }
    if (patch.notes !== undefined) entry.notes = patch.notes
  }

  function deleteValueEntry(fundId, entryId) {
    const fund = findById(fundId)
    if (!fund) return
    const idx = fund.valueEntries.findIndex((e) => e.id === entryId)
    if (idx !== -1) fund.valueEntries.splice(idx, 1)
  }

  function valueHistory(fund) {
    return [...fund.valueEntries].sort((a, b) => new Date(a.date) - new Date(b.date) || new Date(a.createdAt) - new Date(b.createdAt))
  }

  function portfolioInvested() {
    return state.reduce((sum, f) => sum + totalInvested(f), 0)
  }

  function portfolioValue() {
    return state.reduce((sum, f) => sum + currentValue(f), 0)
  }

  // realized + unrealized across all funds (without withdrawals: value - invested, as before)
  function portfolioProfitLoss() {
    return portfolioPerformance(state).totalGain
  }

  function portfolioPerf() {
    return portfolioPerformance(state)
  }

  return {
    funds: state,
    findById,
    sortedContributions,
    sortedWithdrawals,
    sortedValueEntries,
    perf,
    portfolioPerf,
    addWithdrawal,
    deleteWithdrawal,
    totalInvested,
    latestValueEntry,
    currentValue,
    profitLoss,
    profitLossPercent,
    changeSinceLast,
    addFund,
    updateFund,
    deleteFund,
    undoDelete,
    addContribution,
    deleteContribution,
    addValueEntry,
    updateValueEntry,
    deleteValueEntry,
    valueHistory,
    portfolioInvested,
    portfolioValue,
    portfolioProfitLoss,
  }
}
