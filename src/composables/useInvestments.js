import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const state = reactive(get(STORAGE_KEYS.INVESTMENTS, []))

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

  function totalInvested(fund) {
    return fund.contributions.reduce((sum, c) => sum + c.amount, 0)
  }

  function latestValueEntry(fund) {
    return sortedValueEntries(fund)[0] || null
  }

  function currentValue(fund) {
    return latestValueEntry(fund)?.value ?? totalInvested(fund)
  }

  function profitLoss(fund) {
    return currentValue(fund) - totalInvested(fund)
  }

  function profitLossPercent(fund) {
    const invested = totalInvested(fund)
    return invested > 0 ? (profitLoss(fund) / invested) * 100 : 0
  }

  // Change vs the previous value entry, with any contributions made in between backed out
  // so a top-up isn't counted as "profit."
  function changeSinceLast(fund) {
    const entries = sortedValueEntries(fund) // newest first
    if (entries.length < 2) return null
    const [latest, previous] = entries
    const rawDelta = latest.value - previous.value
    const contributedBetween = fund.contributions
      .filter((c) => new Date(c.date) > new Date(previous.date) && new Date(c.date) <= new Date(latest.date))
      .reduce((sum, c) => sum + c.amount, 0)
    return rawDelta - contributedBetween
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

  function addContribution(fundId, { date, amount, notes }) {
    const fund = findById(fundId)
    if (!fund) throw new Error('Fund not found')
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    fund.contributions.push({
      id: generateId(),
      date: date || new Date().toISOString(),
      amount: amt,
      notes: notes || '',
      createdAt: new Date().toISOString(),
    })
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

  function portfolioProfitLoss() {
    return portfolioValue() - portfolioInvested()
  }

  return {
    funds: state,
    findById,
    sortedContributions,
    sortedValueEntries,
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
