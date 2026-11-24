<script setup>
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad } from '../composables/useAdmin'
import { formatBytes } from '../utils/receipts.js'

const { data, error } = useAdminLoad(() => adminGet('/api/admin/storage'))
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4" data-testid="admin-storage">
    <AdminNav />
    <p class="m-0 text-sm text-muted-foreground">Counts and sizes only. Receipt images and file names are never shown.</p>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <Card v-if="data">
      <CardHeader><CardTitle class="text-base">{{ data.receipts }} receipts, {{ formatBytes(data.receiptBytes) }}; records {{ formatBytes(data.recordBytes) }}</CardTitle></CardHeader>
      <CardContent class="overflow-x-auto" tabindex="0" role="region" aria-label="Table (scrolls sideways)">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Account</th><th class="pr-4 text-right">Receipts</th><th class="pr-4 text-right">Receipt storage</th><th class="pr-4 text-right">Records</th><th class="text-right">Record storage</th></tr></thead>
          <tbody>
            <tr v-for="u in data.perUser" :key="u.userId" class="border-t border-border" data-testid="storage-row"><td class="py-1.5 pr-4">{{ u.email }}</td><td class="amount pr-4 text-right">{{ u.receipts }}</td><td class="amount pr-4 text-right">{{ formatBytes(u.receiptBytes) }}</td><td class="amount pr-4 text-right">{{ u.records }}</td><td class="amount text-right">{{ formatBytes(u.recordBytes) }}</td></tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
</template>
