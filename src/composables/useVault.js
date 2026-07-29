import { reactive } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { generateId } from '../utils/id.js'
import { deriveEncryptionKey, encryptJSON, decryptJSON, randomSaltB64 } from '../utils/crypto.js'

const emptyVault = () => ({
  bankAccounts: [],
  cards: [],
  cnic: { number: '', expiry: '', issuingInfo: '' },
  investments: [],
})

const session = reactive({
  isSetUp: !!get(STORAGE_KEYS.VAULT, null),
  isUnlocked: false,
  data: null, // decrypted plaintext, memory-only while unlocked
})

let activeKey = null

export function useVault() {
  function refreshIsSetUp() {
    session.isSetUp = !!get(STORAGE_KEYS.VAULT, null)
  }

  async function setupPassphrase(passphrase) {
    const salt = randomSaltB64()
    const key = await deriveEncryptionKey(passphrase, salt)
    const data = emptyVault()
    const payload = await encryptJSON(data, key)
    set(STORAGE_KEYS.VAULT, { salt, ...payload })
    activeKey = key
    session.data = data
    session.isUnlocked = true
    session.isSetUp = true
  }

  async function unlock(passphrase) {
    const record = get(STORAGE_KEYS.VAULT, null)
    if (!record) return false
    try {
      const key = await deriveEncryptionKey(passphrase, record.salt)
      const data = await decryptJSON(record, key)
      activeKey = key
      session.data = data
      session.isUnlocked = true
      return true
    } catch {
      return false
    }
  }

  function lock() {
    session.isUnlocked = false
    session.data = null
    activeKey = null
  }

  async function persist() {
    if (!activeKey || !session.data) return
    const record = get(STORAGE_KEYS.VAULT, null)
    const payload = await encryptJSON(session.data, activeKey)
    set(STORAGE_KEYS.VAULT, { salt: record.salt, ...payload })
  }

  async function addBankAccount(entry) {
    session.data.bankAccounts.push({ id: generateId(), ...entry })
    await persist()
  }

  async function updateBankAccount(id, patch) {
    const item = session.data.bankAccounts.find((b) => b.id === id)
    if (item) Object.assign(item, patch)
    await persist()
  }

  async function deleteBankAccount(id) {
    session.data.bankAccounts = session.data.bankAccounts.filter((b) => b.id !== id)
    await persist()
  }

  async function addCard(entry) {
    session.data.cards.push({ id: generateId(), ...entry })
    await persist()
  }

  async function updateCard(id, patch) {
    const item = session.data.cards.find((c) => c.id === id)
    if (item) Object.assign(item, patch)
    await persist()
  }

  async function deleteCard(id) {
    session.data.cards = session.data.cards.filter((c) => c.id !== id)
    await persist()
  }

  async function updateCnic(patch) {
    Object.assign(session.data.cnic, patch)
    await persist()
  }

  async function addInvestment(entry) {
    session.data.investments.push({ id: generateId(), ...entry })
    await persist()
  }

  async function updateInvestment(id, patch) {
    const item = session.data.investments.find((i) => i.id === id)
    if (item) Object.assign(item, patch)
    await persist()
  }

  async function deleteInvestment(id) {
    session.data.investments = session.data.investments.filter((i) => i.id !== id)
    await persist()
  }

  return {
    session,
    refreshIsSetUp,
    setupPassphrase,
    unlock,
    lock,
    addBankAccount,
    updateBankAccount,
    deleteBankAccount,
    addCard,
    updateCard,
    deleteCard,
    updateCnic,
    addInvestment,
    updateInvestment,
    deleteInvestment,
  }
}
