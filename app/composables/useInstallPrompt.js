import { ref, computed } from 'vue'

const deferredPrompt = ref(null)
const isInstalled = ref(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt.value = e
})

window.addEventListener('appinstalled', () => {
  deferredPrompt.value = null
  isInstalled.value = true
})

export function useInstallPrompt() {
  const canInstall = computed(() => !!deferredPrompt.value)

  async function promptInstall() {
    if (!deferredPrompt.value) return
    deferredPrompt.value.prompt()
    await deferredPrompt.value.userChoice
    deferredPrompt.value = null
  }

  return { canInstall, isInstalled, promptInstall }
}
