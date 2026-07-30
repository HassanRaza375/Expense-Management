import { createApp } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { router } from './router/index.js'
import { toast } from './components/ui/sonner/index.js'
import './style.css'

const app = createApp(App)
app.use(router)
app.use(VueApexCharts)
app.mount('#app')

const updateSW = registerSW({
  onNeedRefresh() {
    toast('A new version of Hisaab is available', {
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => updateSW(true),
      },
    })
  },
})
