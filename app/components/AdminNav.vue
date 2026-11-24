<script setup>
import { useRoute } from 'vue-router'
import { cn } from '@/lib/utils.js'

// The admin area's own navigation (the app sidebar has a single "Admin" entry).
const route = useRoute()
const items = [
  { path: '/admin', label: 'Overview' },
  { path: '/admin/users', label: 'Users' },
  { path: '/admin/expenses', label: 'Expenses' },
  { path: '/admin/investments', label: 'Investments' },
  { path: '/admin/income', label: 'Income & cash flow' },
  { path: '/admin/storage', label: 'Receipts & storage' },
  { path: '/admin/audit', label: 'Audit log' },
]
const active = (p) => (p === '/admin' ? route.path === '/admin' : route.path === p || route.path.startsWith(p + '/'))
</script>

<template>
  <nav aria-label="Admin" class="flex flex-wrap gap-1 border-b border-border pb-3" data-testid="admin-nav">
    <RouterLink
      v-for="i in items"
      :key="i.path"
      :to="i.path"
      :aria-current="active(i.path) ? 'page' : undefined"
      :class="cn('rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground', active(i.path) && 'bg-accent font-medium text-primary')"
    >
      {{ i.label }}
    </RouterLink>
  </nav>
</template>
