import { reactive, watch } from 'vue'
import { get, set, STORAGE_KEYS } from '../utils/storage.js'

const defaults = {
  profileName: 'You',
  profileAvatar: '',
  currencySymbol: '₨',
  cycleResetDay: 6,
  theme: 'dark',
  overallBudget: 0,
  categoryBudgets: {}, // { [categoryId]: number }
  rollover: false,
  lastCategoryId: '', // category used for the previous new expense (pre-selected in the form)
}

const state = reactive({ ...defaults, ...get(STORAGE_KEYS.SETTINGS, {}) })

watch(
  state,
  (val) => {
    set(STORAGE_KEYS.SETTINGS, { ...val })
  },
  { deep: true }
)

export function useSettings() {
  function updateProfile({ name, avatar }) {
    if (name !== undefined) state.profileName = name
    if (avatar !== undefined) state.profileAvatar = avatar
  }

  function setCurrencySymbol(symbol) {
    state.currencySymbol = symbol || '₨'
  }

  function setCycleResetDay(day) {
    const n = Number(day)
    if (n >= 1 && n <= 31) state.cycleResetDay = n
  }

  function setTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark'
  }

  function toggleTheme() {
    setTheme(state.theme === 'dark' ? 'light' : 'dark')
  }

  function setOverallBudget(amount) {
    state.overallBudget = Math.max(0, Number(amount) || 0)
  }

  function setCategoryBudget(categoryId, amount) {
    state.categoryBudgets[categoryId] = Math.max(0, Number(amount) || 0)
  }

  function removeCategoryBudget(categoryId) {
    delete state.categoryBudgets[categoryId]
  }

  function setRollover(enabled) {
    state.rollover = !!enabled
  }

  function setLastCategoryId(id) {
    state.lastCategoryId = id || ''
  }

  function resetAllSettings() {
    Object.assign(state, defaults)
  }

  return {
    settings: state,
    updateProfile,
    setCurrencySymbol,
    setCycleResetDay,
    setTheme,
    toggleTheme,
    setOverallBudget,
    setCategoryBudget,
    removeCategoryBudget,
    setRollover,
    setLastCategoryId,
    resetAllSettings,
  }
}
