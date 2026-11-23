<script setup>
import { computed, onMounted, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { Menu } from '@lucide/vue'
import { useAppLock } from '../composables/useAppLock.js'
import { useSettings } from '../composables/useSettings.js'
import { useRecurring } from '../composables/useRecurring.js'
import { useSidebar } from '../composables/useSidebar.js'
import { currentCycle } from '../utils/reporting.js'
import { toDateCycle, sanitizeResetDay } from '../utils/budgetMath.js'
import { ensureMeta } from '../utils/storage.js'
import { Toaster } from '../components/ui/sonner/index.js'
import { Button } from '../components/ui/button/index.js'
import AppSidebar from '../components/AppSidebar.vue'
import LockView from '../views/LockView.vue'
import PwaUpdateToast from '../components/PwaUpdateToast.vue'
import SyncStatus from '../components/SyncStatus.vue'
import FirstSignInDialog from '../components/FirstSignInDialog.vue'
import { startSync } from '../composables/useSync'

ensureMeta()

// account mode only: starts the sync engine (nothing happens in guest mode or while accounts are off)
onMounted(() => {
  startSync()
})

const { state: lockState } = useAppLock()
const { settings } = useSettings()
const { getPending } = useRecurring()
const sidebar = useSidebar()
const route = useRoute()

watchEffect(() => {
  document.documentElement.setAttribute('data-theme', settings.theme)
})

const pendingRecurringCount = computed(() => {
  const cycle = toDateCycle(currentCycle(new Date(), sanitizeResetDay(settings.cycleResetDay)))
  return getPending(cycle).length
})
</script>

<template>
  <div>
  <Toaster />
  <PwaUpdateToast />
  <FirstSignInDialog />
  <LockView v-if="!lockState.isUnlocked" />
  <div v-else class="flex min-h-screen">
    <AppSidebar :pending-recurring-count="pendingRecurringCount" />
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" aria-label="Open or close the menu" @click="sidebar.toggle()">
          <Menu class="h-5 w-5" />
        </Button>
        <span class="font-display text-base font-semibold">{{ route.meta.title }}</span>
        <span class="flex-1" />
        <SyncStatus />
      </header>
      <main class="min-w-0 flex-1 p-4 md:p-8">
        <slot />
      </main>
    </div>
  </div>
  </div>
</template>
