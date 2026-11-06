import { createApp } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import { registerSW } from 'virtual:pwa-register'
import { prepareData } from './utils/startup.js'
import './style.css'

// The data version is checked (and migrated, with a safety snapshot) BEFORE the app, the router or any composable
// is loaded, because composables read localStorage when their module is first imported. If the stored data is from a
// newer version of Hisaab, or an update fails, the app does NOT start and nothing more is written.
function showBlocked(message) {
  const root = document.getElementById('app')
  root.innerHTML = ''
  const box = document.createElement('div')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'max-width:32rem;margin:15vh auto;padding:1.5rem;border:1px solid var(--border,#2b3640);border-radius:12px;background:var(--card,#1a2029);color:var(--foreground,#e7ecef);font-family:Inter,sans-serif;line-height:1.5'
  const title = document.createElement('h1')
  title.textContent = 'Hisaab did not start'
  title.style.cssText = 'margin:0 0 .75rem;font-size:1.25rem'
  const text = document.createElement('p')
  text.textContent = message
  text.style.margin = '0 0 1rem'
  const button = document.createElement('button')
  button.textContent = 'Reload'
  button.style.cssText = 'padding:.5rem 1rem;border-radius:8px;border:0;background:var(--primary,#4a9498);color:var(--primary-foreground,#0b1113);font-weight:600;cursor:pointer'
  button.onclick = () => location.reload()
  box.append(title, text, button)
  root.append(box)
}

async function start() {
  const outcome = await prepareData()
  if (outcome.blocked) {
    showBlocked(outcome.message)
    return
  }

  const [{ default: App }, { router }] = await Promise.all([import('./App.vue'), import('./router/index.js')])
  const app = createApp(App)
  app.use(router)
  app.use(VueApexCharts)
  app.mount('#app')

  const updateSW = registerSW({
    async onNeedRefresh() {
      const { toast } = await import('./components/ui/sonner/index.js')
      toast('A new version of Hisaab is available', {
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => updateSW(true),
        },
      })
    },
  })
}

start()
