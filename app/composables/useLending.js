import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'

const state = reactive(get(STORAGE_KEYS.LENDING, []))

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.LENDING, val)
  },
  { deep: true }
)

export const LOAN_DIRECTIONS = ['lent', 'borrowed']

let pendingUndo = null

export function useLending() {
  function findById(id) {
    return state.find((l) => l.id === id)
  }

  function direction(loan) {
    return loan.direction === 'borrowed' ? 'borrowed' : 'lent'
  }

  function personName(loan) {
    return loan.personName ?? loan.borrowerName ?? ''
  }

  function loansByDirection(dir) {
    return state.filter((l) => direction(l) === dir)
  }

  function totalRepaid(loan) {
    return loan.repayments.reduce((sum, r) => sum + r.amount, 0)
  }

  function remaining(loan) {
    return Math.max(loan.amount - totalRepaid(loan), 0)
  }

  function status(loan) {
    const repaid = totalRepaid(loan)
    if (repaid >= loan.amount) return 'paid'
    if (repaid > 0) return 'partial'
    return 'outstanding'
  }

  function addLoan({ direction: dir, personName: name, amount, date, dueDate, notes, accountId }) {
    if (!name || !name.trim()) throw new Error('Name is required')
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    const loan = {
      id: generateId(),
      direction: LOAN_DIRECTIONS.includes(dir) ? dir : 'lent',
      personName: name.trim(),
      amount: amt,
      date: date || new Date().toISOString(),
      dueDate: dueDate || null,
      notes: notes || '',
      repayments: [],
      createdAt: new Date().toISOString(),
    }
    if (accountId) loan.accountId = accountId // optional; absent = no account (money movement not tracked in a balance)
    state.push(loan)
    return loan
  }

  function updateLoan(id, patch) {
    const loan = findById(id)
    if (!loan) return
    if (patch.personName !== undefined) {
      if (!patch.personName.trim()) throw new Error('Name is required')
      loan.personName = patch.personName.trim()
    }
    if (patch.amount !== undefined) {
      const amt = Number(patch.amount)
      if (!(amt > 0)) throw new Error('Amount must be greater than 0')
      if (amt < totalRepaid(loan)) throw new Error('Amount cannot be less than what has already been repaid')
      loan.amount = amt
    }
    if (patch.date !== undefined) loan.date = patch.date
    if (patch.dueDate !== undefined) loan.dueDate = patch.dueDate
    if (patch.notes !== undefined) loan.notes = patch.notes
    if (patch.accountId !== undefined) {
      if (patch.accountId) loan.accountId = patch.accountId
      else delete loan.accountId
    }
  }

  function deleteLoan(id) {
    const idx = state.findIndex((l) => l.id === id)
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

  function addRepayment(loanId, { date, amount, notes, accountId }) {
    const loan = findById(loanId)
    if (!loan) throw new Error('Loan not found')
    const amt = Number(amount)
    if (!(amt > 0)) throw new Error('Amount must be greater than 0')
    if (amt > remaining(loan)) throw new Error('Repayment exceeds remaining balance')
    const repayment = {
      id: generateId(),
      date: date || new Date().toISOString(),
      amount: amt,
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }
    if (accountId) repayment.accountId = accountId // optional
    loan.repayments.push(repayment)
  }

  function deleteRepayment(loanId, repaymentId) {
    const loan = findById(loanId)
    if (!loan) return
    const idx = loan.repayments.findIndex((r) => r.id === repaymentId)
    if (idx !== -1) loan.repayments.splice(idx, 1)
  }

  function totalOutstanding(dir) {
    const list = dir ? loansByDirection(dir) : state
    return list.reduce((sum, loan) => sum + remaining(loan), 0)
  }

  return {
    loans: state,
    findById,
    direction,
    personName,
    loansByDirection,
    totalRepaid,
    remaining,
    status,
    addLoan,
    updateLoan,
    deleteLoan,
    undoDelete,
    addRepayment,
    deleteRepayment,
    totalOutstanding,
  }
}
