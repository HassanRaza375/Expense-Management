import { reactive } from 'vue'
import { get, set } from '../utils/storage.js'

const STORAGE_KEY = 'ui:sidebarOpen'

function isDesktop() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
}

const state = reactive({
  open: get(STORAGE_KEY, isDesktop()), // desktop dock: persisted
  mobileOpen: false, // mobile drawer: session-only
})

export function useSidebar() {
  function toggle() {
    if (isDesktop()) {
      state.open = !state.open
      set(STORAGE_KEY, state.open)
    } else {
      state.mobileOpen = !state.mobileOpen
    }
  }

  function closeMobile() {
    state.mobileOpen = false
  }

  return { state, toggle, closeMobile }
}
