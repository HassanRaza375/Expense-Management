<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad, minor } from '../composables/useAdmin'

const route = useRoute()
const userId = computed(() => (typeof route.query.userId === 'string' ? route.query.userId : ''))
const { data, error } = useAdminLoad(() => adminGet('/api/admin/investments' + (userId.value ? '?userId=' + encodeURIComponent(userId.value) : '')))
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4" data-testid="admin-investments">
    <AdminNav />
    <p class="m-0 text-sm text-muted-foreground">{{ userId ? 'One account.' : 'All accounts.' }} {{ data ? data.funds : 0 }} funds. Money put in and taken out, and the latest value recorded for each fund.</p>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <template v-if="data">
      <Card>
        <CardHeader><CardTitle class="text-base">By month</CardTitle></CardHeader>
        <CardContent class="overflow-x-auto" tabindex="0" role="region" aria-label="Table (scrolls sideways)">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Month</th><th class="pr-4 text-right">Put in</th><th class="text-right">Taken out</th></tr></thead>
            <tbody>
              <tr v-for="m in data.byMonth" :key="m.month" class="border-t border-border"><td class="py-1 pr-4">{{ m.month }}</td><td class="amount pr-4 text-right">{{ minor(m.contributed) }}</td><td class="amount text-right">{{ minor(m.withdrawn) }}</td></tr>
              <tr v-if="!data.byMonth.length"><td colspan="3" class="py-2 text-muted-foreground">Nothing yet.</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">By fund</CardTitle></CardHeader>
        <CardContent class="overflow-x-auto" tabindex="0" role="region" aria-label="Table (scrolls sideways)">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Fund</th><th class="pr-4 text-right">Put in</th><th class="pr-4 text-right">Taken out</th><th class="pr-4 text-right">Net in</th><th class="text-right">Latest value</th></tr></thead>
            <tbody>
              <tr v-for="f in data.perFund" :key="f.fundId" class="border-t border-border"><td class="py-1 pr-4 font-mono text-xs">{{ f.fundId.slice(0, 8) }}</td><td class="amount pr-4 text-right">{{ minor(f.contributed) }}</td><td class="amount pr-4 text-right">{{ minor(f.withdrawn) }}</td><td class="amount pr-4 text-right">{{ minor(f.netIn) }}</td><td class="amount text-right">{{ f.latestValue === null ? '-' : minor(f.latestValue) }}</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
