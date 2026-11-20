import { reactive } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'
import { hashPassword, verifyPassword, randomSaltB64 } from '../utils/crypto.js'

const SESSION_KEY = 'hisaab:session-unlocked'

const state = reactive({
  isUnlocked: sessionStorage.getItem(SESSION_KEY) === 'true',
  isFirstRun: !get(STORAGE_KEYS.APPLOCK, null),
})

export function useAppLock() {
  function refreshFirstRun() {
    state.isFirstRun = !get(STORAGE_KEYS.APPLOCK, null)
  }

  async function setPassword(password) {
    const salt = randomSaltB64()
    const passwordHash = await hashPassword(password, salt)
    set(STORAGE_KEYS.APPLOCK, { passwordHash, salt, createdAt: new Date().toISOString() })
    state.isFirstRun = false
    unlock()
  }

  async function tryUnlock(password) {
    const record = get(STORAGE_KEYS.APPLOCK, null)
    if (!record) return false
    const ok = await verifyPassword(password, record.salt, record.passwordHash)
    if (ok) unlock()
    return ok
  }

  function unlock() {
    state.isUnlocked = true
    sessionStorage.setItem(SESSION_KEY, 'true')
  }

  function lock() {
    state.isUnlocked = false
    sessionStorage.removeItem(SESSION_KEY)
  }

  async function changePassword(currentPassword, newPassword) {
    const record = get(STORAGE_KEYS.APPLOCK, null)
    if (!record) return false
    const ok = await verifyPassword(currentPassword, record.salt, record.passwordHash)
    if (!ok) return false
    const salt = randomSaltB64()
    const passwordHash = await hashPassword(newPassword, salt)
    set(STORAGE_KEYS.APPLOCK, { passwordHash, salt, createdAt: record.createdAt })
    return true
  }

  return {
    state,
    refreshFirstRun,
    setPassword,
    tryUnlock,
    unlock,
    lock,
    changePassword,
  }
}
