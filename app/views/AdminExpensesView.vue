<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad, minor } from '../composables/useAdmin'

const route = useRoute()
const userId = computed(() => (typeof route.query.userId === 'string' ? route.query.userId : ''))
const { data, error } = useAdminLoad(() => adminGet('/api/admin/expenses' + (userId.value ? '?userId=' + encodeURIComponent(userId.value) : '')))
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4" data-testid="admin-expenses">
    <AdminNav />
    <p class="m-0 text-sm text-muted-foreground">{{ userId ? 'One account.' : 'All accounts.' }} Months are the local days the accounts' own apps recorded. Amounts, dates and categories only.</p>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <template v-if="data">
      <Card>
        <CardHeader><CardTitle class="text-base">By month</CardTitle></CardHeader>
        <CardContent class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Month</th><th class="pr-4 text-right">Spent</th><th class="pr-4 text-right">Refunds</th><th class="pr-4 text-right">Net</th><th class="text-right">Count</th></tr></thead>
            <tbody>
              <tr v-for="m in data.byMonth" :key="m.month" class="border-t border-border" data-testid="month-row"><td class="py-1 pr-4">{{ m.month }}</td><td class="amount pr-4 text-right">{{ minor(m.gross) }}</td><td class="amount pr-4 text-right">{{ minor(m.refunds) }}</td><td class="amount pr-4 text-right font-medium">{{ minor(m.net) }}</td><td class="text-right">{{ m.count }}</td></tr>
              <tr v-if="!data.byMonth.length"><td colspan="5" class="py-2 text-muted-foreground">No expenses.</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle class="text-base">By year</CardTitle></CardHeader>
          <CardContent><table class="w-full text-sm"><tbody><tr v-for="y in data.byYear" :key="y.year" class="border-t border-border"><td class="py-1">{{ y.year }}</td><td class="amount text-right">{{ minor(y.net) }}</td></tr></tbody></table></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle class="text-base">By category (net)</CardTitle></CardHeader>
          <CardContent><table class="w-full text-sm"><tbody><tr v-for="c in data.byCategory" :key="c.categoryId" class="border-t border-border"><td class="py-1">{{ c.categoryId }}</td><td class="amount text-right">{{ minor(c.net) }}</td></tr></tbody></table></CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
