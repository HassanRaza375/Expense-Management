<script setup>
import { ref, watch } from 'vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, useAdminLoad, when } from '../composables/useAdmin'
import { formatBytes } from '../utils/receipts.js'

const search = ref('')
const role = ref('')
const status = ref('')
const page = ref(1)
const qs = () => new URLSearchParams({ ...(search.value ? { search: search.value } : {}), ...(role.value ? { role: role.value } : {}), ...(status.value ? { status: status.value } : {}), page: String(page.value) }).toString()
const { data, error, loading, load } = useAdminLoad(() => adminGet('/api/admin/users?' + qs()))

let timer = null
watch([search, role, status], () => {
  page.value = 1
  clearTimeout(timer)
  timer = setTimeout(load, 300)
})
function go(p) {
  page.value = p
  load()
}
</script>

<template>
  <div class="flex max-w-6xl flex-col gap-4" data-testid="admin-users">
    <AdminNav />
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <label for="u-search" class="text-xs text-muted-foreground">Search name or email</label>
        <Input id="u-search" v-model="search" type="search" class="w-64" data-testid="user-search" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="u-role" class="text-xs text-muted-foreground">Role</label>
        <select id="u-role" v-model="role" class="h-9 rounded-md border border-input bg-transparent px-2 text-sm" data-testid="user-role">
          <option value="">All</option>
          <option value="user">User</option>
          <option value="superadmin">Super admin</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label for="u-status" class="text-xs text-muted-foreground">Status</label>
        <select id="u-status" v-model="status" class="h-9 rounded-md border border-input bg-transparent px-2 text-sm" data-testid="user-status">
          <option value="">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
    </div>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <Card v-if="data">
      <CardContent class="overflow-x-auto pt-6" tabindex="0" role="region" aria-label="Table (scrolls sideways)">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-muted-foreground"><th class="py-1 pr-4">Email</th><th class="pr-4">Name</th><th class="pr-4">Role</th><th class="pr-4">Status</th><th class="pr-4 text-right">Records</th><th class="pr-4 text-right">Stored</th><th>Last sync</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in data.users" :key="u.id" class="border-t border-border" data-testid="user-row">
              <td class="py-1.5 pr-4"><RouterLink :to="'/admin/users/' + u.id" class="text-primary underline-offset-2 hover:underline">{{ u.email }}</RouterLink></td>
              <td class="pr-4">{{ u.name }}</td>
              <td class="pr-4"><Badge v-if="u.role === 'superadmin'" variant="secondary">Super admin</Badge><span v-else>User</span></td>
              <td class="pr-4"><Badge v-if="u.disabled" variant="warn">Disabled</Badge><span v-else>Enabled</span></td>
              <td class="amount pr-4 text-right">{{ u.records }}</td>
              <td class="amount pr-4 text-right">{{ formatBytes(u.bytes) }}</td>
              <td>{{ when(u.lastSyncAt) }}</td>
            </tr>
            <tr v-if="!data.users.length"><td colspan="7" class="py-2 text-muted-foreground">No users match.</td></tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
    <div v-if="data && data.pages > 1" class="flex items-center gap-2 text-sm" data-testid="user-pager">
      <Button variant="outline" size="sm" :disabled="data.page <= 1 || loading" @click="go(data.page - 1)">Previous</Button>
      <span>Page {{ data.page }} of {{ data.pages }} ({{ data.total }} users)</span>
      <Button variant="outline" size="sm" :disabled="data.page >= data.pages || loading" @click="go(data.page + 1)">Next</Button>
    </div>
  </div>
</template>
