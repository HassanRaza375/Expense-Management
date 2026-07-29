<script setup>
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { LayoutDashboard, Receipt, ReceiptText, Repeat, Tags, Target, Lock, Package, Settings, Sun, Moon, BookText } from '@lucide/vue'
import { useSettings } from '../composables/useSettings.js'
import { useSidebar } from '../composables/useSidebar.js'
import { cn } from '@/lib/utils.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'

defineProps({
  pendingRecurringCount: { type: Number, default: 0 },
})

const { settings, toggleTheme } = useSettings()
const sidebar = useSidebar()
const route = useRoute()

watch(
  () => route.path,
  () => sidebar.closeMobile()
)

const items = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/expenses', label: 'Expenses', icon: Receipt },
  { path: '/bills', label: 'Bills', icon: ReceiptText },
  { path: '/recurring', label: 'Recurring', icon: Repeat },
  { path: '/categories', label: 'Categories', icon: Tags },
  { path: '/budget', label: 'Budget', icon: Target },
  { path: '/vault', label: 'Vault', icon: Lock },
  { path: '/assets', label: 'Assets', icon: Package },
  { path: '/settings', label: 'Settings', icon: Settings },
]
</script>

<template>
  <div
    v-if="sidebar.state.mobileOpen"
    class="fixed inset-0 z-40 bg-black/50 md:hidden"
    @click="sidebar.closeMobile()"
  />

  <aside
    :class="
      cn(
        'fixed inset-y-0 left-0 top-0 z-50 h-screen w-64 overflow-hidden border-r border-border bg-card transition-all duration-200 ease-in-out md:sticky md:z-auto',
        sidebar.state.mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        sidebar.state.open ? 'md:w-64' : 'md:w-0 md:border-r-0'
      )
    "
  >
    <div class="flex h-full w-64 flex-col">
      <div class="flex items-center gap-2 px-5 pb-4 pt-6">
        <BookText class="h-5 w-5 shrink-0 text-primary" />
        <span class="font-display text-lg font-bold text-primary">Hisaab</span>
      </div>

      <nav class="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
        <RouterLink
          v-for="item in items"
          :key="item.path"
          :to="item.path"
          :class="
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
              route.path === item.path && 'bg-accent font-medium text-primary'
            )
          "
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span class="flex-1 text-left">{{ item.label }}</span>
          <Badge v-if="item.path === '/recurring' && pendingRecurringCount > 0" variant="warn" class="px-1.5">
            {{ pendingRecurringCount }}
          </Badge>
        </RouterLink>
      </nav>

      <div class="border-t border-border p-3">
        <Button variant="outline" size="sm" class="w-full" @click="toggleTheme">
          <Sun v-if="settings.theme === 'dark'" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
          {{ settings.theme === 'dark' ? 'Light' : 'Dark' }}
        </Button>
      </div>
    </div>
  </aside>
</template>
