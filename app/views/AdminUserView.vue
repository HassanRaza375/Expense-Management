<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import AdminNav from '../components/AdminNav.vue'
import { adminGet, adminPatch, adminDelete, adminPost, useAdminLoad, minor, when } from '../composables/useAdmin'
import { friendly } from '../lib/account/api'
import { formatBytes } from '../utils/receipts.js'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id))
const { data, error, load } = useAdminLoad(() => adminGet('/api/admin/users/' + encodeURIComponent(id.value)))

const form = ref({ name: '', email: '', role: 'user', disabled: false })
watch(
  () => data.value?.user,
  (u) => u && (form.value = { name: u.name, email: u.email, role: u.role, disabled: u.disabled }),
  { immediate: true }
)

const message = ref('')
const busy = ref(false)
async function act(fn, ok) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    await fn()
    if (ok) toast(ok)
  } catch (e) {
    message.value = friendly(e)
  } finally {
    busy.value = false
  }
}
const save = () =>
  act(async () => {
    const u = data.value.user
    const patch = {}
    for (const k of ['name', 'email', 'role', 'disabled']) if (form.value[k] !== u[k]) patch[k] = form.value[k]
    if (!Object.keys(patch).length) return
    await adminPatch('/api/admin/users/' + encodeURIComponent(id.value), patch)
    await load()
  }, 'Saved')
const resetEmail = () => act(() => adminPost('/api/admin/users/' + encodeURIComponent(id.value) + '/reset-email'), 'Reset email sent')

const confirmEmail = ref('')
const canDelete = computed(() => data.value && confirmEmail.value.trim().toLowerCase() === data.value.user.email.toLowerCase())
const remove = () =>
  act(async () => {
    await adminDelete('/api/admin/users/' + encodeURIComponent(id.value), { confirm: confirmEmail.value })
    router.replace('/admin/users')
  }, 'User deleted')
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4" data-testid="admin-user">
    <AdminNav />
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <template v-if="data">
      <Card>
        <CardHeader>
          <CardTitle class="flex flex-wrap items-center gap-2 text-base">{{ data.user.email }} <Badge v-if="data.user.role === 'superadmin'" variant="secondary">Super admin</Badge><Badge v-if="data.user.disabled" variant="warn">Disabled</Badge></CardTitle>
          <CardDescription>Joined {{ when(data.user.createdAt) }}. Last sync {{ when(data.user.lastSyncAt) }}. {{ data.user.records }} records, {{ formatBytes(data.user.bytes) }}.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <div class="flex flex-wrap gap-3">
            <div class="flex flex-col gap-1"><Label for="au-name">Name</Label><Input id="au-name" v-model="form.name" type="text" class="w-56" maxlength="80" data-testid="edit-name" /></div>
            <div class="flex flex-col gap-1"><Label for="au-email">Email</Label><Input id="au-email" v-model="form.email" type="email" class="w-64" data-testid="edit-email" /></div>
            <div class="flex flex-col gap-1">
              <Label for="au-role">Role</Label>
              <select id="au-role" v-model="form.role" class="h-9 rounded-md border border-input bg-transparent px-2 text-sm" data-testid="edit-role"><option value="user">User</option><option value="superadmin">Super admin</option></select>
            </div>
            <label class="flex items-end gap-2 pb-2 text-sm"><input v-model="form.disabled" type="checkbox" data-testid="edit-disabled" /> Disabled (cannot sign in)</label>
          </div>
          <p v-if="message" class="m-0 text-sm text-destructive" role="alert" data-testid="admin-message">{{ message }}</p>
          <div class="flex flex-wrap gap-2">
            <Button :disabled="busy" data-testid="user-save" @click="save">Save</Button>
            <Button variant="outline" :disabled="busy" data-testid="user-reset" @click="resetEmail">Send password-reset email</Button>
          </div>
          <p class="m-0 text-xs text-muted-foreground">Every change is written to the audit log. You cannot demote, disable or delete yourself, and the last super admin cannot be demoted, disabled or deleted. Passwords are never shown or set here.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">What this account holds</CardTitle><CardDescription>Counts of records by kind. Their content is never read.</CardDescription></CardHeader>
        <CardContent class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span v-for="(n, c) in data.counts" :key="c">{{ c }}: <strong class="amount">{{ n }}</strong></span>
          <span v-if="!Object.keys(data.counts).length" class="text-muted-foreground">Nothing synced yet.</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">Totals</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-2 text-sm">
          <div>Expenses, net: <strong class="amount" data-testid="user-expense-total">{{ minor(data.expenses.total) }}</strong> in {{ data.expenses.count }} records.
            <RouterLink :to="'/admin/expenses?userId=' + data.user.id" class="text-primary underline-offset-2 hover:underline">By month</RouterLink></div>
          <div>Income: <strong class="amount">{{ minor(data.income.total) }}</strong>. <RouterLink :to="'/admin/income?userId=' + data.user.id" class="text-primary underline-offset-2 hover:underline">Cash flow</RouterLink></div>
          <div>Put into funds: <strong class="amount">{{ minor(data.investments.contributed) }}</strong>, taken out: <strong class="amount">{{ minor(data.investments.withdrawn) }}</strong>.</div>
          <div>Receipts: <strong class="amount">{{ data.storage.receipts }}</strong> ({{ formatBytes(data.storage.receiptBytes) }}).</div>
        </CardContent>
      </Card>

      <Card class="border-destructive/50">
        <CardHeader><CardTitle class="text-base text-destructive">Delete this account</CardTitle><CardDescription>Removes the account and everything stored for it, including its files. This cannot be undone.</CardDescription></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <Label for="au-confirm">Type their email address ({{ data.user.email }}) to confirm</Label>
          <div class="flex flex-wrap gap-2">
            <Input id="au-confirm" v-model="confirmEmail" type="email" autocomplete="off" class="max-w-72" data-testid="user-delete-confirm" />
            <Button variant="destructive" :disabled="!canDelete || busy" data-testid="user-delete" @click="remove">Delete account</Button>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
