<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad, minor } from '../composables/useAdmin'

const route = useRoute()
const userId = computed(() => (typeof route.query.userId === 'string' ? route.query.userId : ''))
const { data, error } = useAdminLoad(() => adminGet('/api/admin/income' + (userId.value ? '?userId=' + encodeURIComponent(userId.value) : '')))
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4" data-testid="admin-income">
    <AdminNav />
    <p class="m-0 text-sm text-muted-foreground">{{ userId ? 'One account.' : 'All accounts.' }} Cash flow is income minus the net of expenses, month by month.</p>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <template v-if="data">
      <Card>
        <CardHeader><CardTitle class="text-base">Income and cash flow</CardTitle></CardHeader>
        <CardContent class="overflow-x-auto" tabindex="0" role="region" aria-label="Table (scrolls sideways)">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Month</th><th class="pr-4 text-right">Income</th><th class="pr-4 text-right">Expenses</th><th class="text-right">Cash flow</th></tr></thead>
            <tbody>
              <tr v-for="m in data.byMonth" :key="m.month" class="border-t border-border" data-testid="flow-row"><td class="py-1 pr-4">{{ m.month }}</td><td class="amount pr-4 text-right">{{ minor(m.income) }}</td><td class="amount pr-4 text-right">{{ minor(m.expenses) }}</td><td class="amount text-right font-medium" :class="m.net < 0 ? 'text-destructive' : ''">{{ minor(m.net) }}</td></tr>
              <tr v-if="!data.byMonth.length"><td colspan="4" class="py-2 text-muted-foreground">Nothing yet.</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">Income by kind</CardTitle></CardHeader>
        <CardContent><table class="w-full text-sm"><tbody><tr v-for="k in data.byKind" :key="k.kind" class="border-t border-border"><td class="py-1">{{ k.kind }}</td><td class="amount text-right">{{ minor(k.total) }}</td></tr></tbody></table></CardContent>
      </Card>
    </template>
  </div>
</template>
