<script setup>
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad, minor } from '../composables/useAdmin'
import { formatBytes } from '../utils/receipts.js'

const { data, error, loading } = useAdminLoad(() => adminGet('/api/admin/overview'))
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4" data-testid="admin-overview">
    <AdminNav />
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="m-0 text-sm text-muted-foreground">Loading...</p>
    <template v-else-if="data">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card v-for="s in [['Users', data.users], ['Super admins', data.superAdmins], ['Disabled', data.disabled], ['Synced in the last 7 days', data.activeLast7Days], ['Records', data.records], ['Stored', formatBytes(data.bytes)]]" :key="s[0]">
          <CardContent class="pt-6">
            <div class="text-xs text-muted-foreground">{{ s[0] }}</div>
            <div class="amount text-2xl font-semibold" :data-testid="'stat-' + s[0]">{{ s[1] }}</div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle class="text-base">Expenses, the last 12 months (all accounts)</CardTitle></CardHeader>
        <CardContent class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Month</th><th class="pr-4 text-right">Spent</th><th class="pr-4 text-right">Refunds</th><th class="pr-4 text-right">Net</th><th class="text-right">Count</th></tr></thead>
            <tbody>
              <tr v-for="m in data.expenses" :key="m.month" class="border-t border-border"><td class="py-1 pr-4">{{ m.month }}</td><td class="amount pr-4 text-right">{{ minor(m.gross) }}</td><td class="amount pr-4 text-right">{{ minor(m.refunds) }}</td><td class="amount pr-4 text-right font-medium">{{ minor(m.net) }}</td><td class="text-right">{{ m.count }}</td></tr>
              <tr v-if="!data.expenses.length"><td colspan="5" class="py-2 text-muted-foreground">Nothing yet.</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p class="m-0 text-xs text-muted-foreground">Totals come from amounts, dates and categories only. Notes, receipts, attachments, the Vault and passwords are never read.</p>
    </template>
  </div>
</template>
