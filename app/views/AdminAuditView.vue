<script setup>
import { ref } from 'vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad, when } from '../composables/useAdmin'

const page = ref(1)
const { data, error, loading, load } = useAdminLoad(() => adminGet('/api/admin/audit?page=' + page.value))
function go(p) {
  page.value = p
  load()
}
const describe = (s) => {
  if (!s || typeof s !== 'object') return ''
  if (s.before && s.after) {
    return Object.keys(s.after)
      .filter((k) => s.before[k] !== s.after[k])
      .map((k) => `${k}: ${s.before[k]} to ${s.after[k]}`)
      .join('; ')
  }
  return s.before ? `${s.before.email} (${s.before.role})` : s.email || ''
}
</script>

<template>
  <div class="flex max-w-6xl flex-col gap-4" data-testid="admin-audit">
    <AdminNav />
    <p class="m-0 text-sm text-muted-foreground">Every change an admin makes: who, what, when, and a summary of the account fields that changed. Never notes or other private content.</p>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <Card v-if="data">
      <CardContent class="overflow-x-auto pt-6" tabindex="0" role="region" aria-label="Table (scrolls sideways)">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-4">When</th><th class="pr-4">Who</th><th class="pr-4">Action</th><th>What</th></tr></thead>
          <tbody>
            <tr v-for="e in data.entries" :key="e.id" class="border-t border-border" data-testid="audit-row"><td class="py-1.5 pr-4 whitespace-nowrap">{{ when(e.at) }}</td><td class="pr-4">{{ e.actorEmail }}</td><td class="pr-4 font-mono text-xs">{{ e.action }}</td><td>{{ describe(e.summary) }}</td></tr>
            <tr v-if="!data.entries.length"><td colspan="4" class="py-2 text-muted-foreground">No admin changes yet.</td></tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
    <div v-if="data && data.pages > 1" class="flex items-center gap-2 text-sm">
      <Button variant="outline" size="sm" :disabled="data.page <= 1 || loading" @click="go(data.page - 1)">Previous</Button>
      <span>Page {{ data.page }} of {{ data.pages }}</span>
      <Button variant="outline" size="sm" :disabled="data.page >= data.pages || loading" @click="go(data.page + 1)">Next</Button>
    </div>
  </div>
</template>
