<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download, Upload, ChevronRight, MonitorDown, TriangleAlert } from '@lucide/vue'
import { useSettings } from '../composables/useSettings.js'
import { accountsEnabled, useAccount, refresh as refreshAccount } from '../composables/useAccount'
import UserAvatar from '../components/UserAvatar.vue'
import SyncCard from '../components/SyncCard.vue'
import { receiptCleanup } from '../lib/sync/receiptsApi'
import { deleteSyncDatabase } from '../lib/sync/baseStore'
import { useAppLock } from '../composables/useAppLock.js'
import { useInstallPrompt } from '../composables/useInstallPrompt.js'
import { usageBytes } from '../utils/storage.js'
import { buildBackup, parseBackup, summarizeBackup, applyBackup } from '../utils/backup.js'
import { saveSnapshot, listSnapshots, clearSnapshots } from '../utils/snapshots.js'
import { getAllAttachments, deleteAttachment, clearAllAttachments } from '../utils/attachments.js'
import { receiptStats, formatBytes } from '../utils/receipts.js'
import { useExpenses } from '../composables/useExpenses.js'
import { useCategories } from '../composables/useCategories.js'
import { useAccounts } from '../composables/useAccounts.js'
import { downloadTransactionsCsv } from '../utils/csvExport.js'
import { sortTransactions } from '../utils/reporting.js'
import { Checkbox } from '@/components/ui/checkbox/index.js'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const router = useRouter()

// the optional account (only while accounts are turned on; guest mode shows no account card at all)
const accountsOn = accountsEnabled()
const account = useAccount()
onMounted(() => {
  if (accountsOn) refreshAccount()
})

const { settings, updateProfile, setCurrencySymbol, setCycleResetDay } = useSettings()
const { changePassword } = useAppLock()
const { expenses } = useExpenses()
const { categories } = useCategories()
const { accounts } = useAccounts()
const { canInstall, isInstalled, promptInstall } = useInstallPrompt()

const profileName = ref(settings.profileName)
function saveProfile() {
  updateProfile({ name: profileName.value })
}

const currentPassword = ref('')
const newPassword = ref('')
async function submitPasswordChange() {
  const ok = await changePassword(currentPassword.value, newPassword.value)
  if (ok) {
    toast('Password updated')
    currentPassword.value = ''
    newPassword.value = ''
  } else {
    toast.error('Current password is incorrect')
  }
}

// --- Full backup (everything in one versioned file) ---
const includeAttachments = ref(true)
const exporting = ref(false)

async function exportFull() {
  exporting.value = true
  try {
    const bundle = await buildBackup({ includeAttachments: includeAttachments.value })
    downloadJSON(bundle, `hisaab-backup-${new Date().toISOString().slice(0, 10)}.json`)
    const files = bundle.attachments?.length
    toast.success(files ? `Backup downloaded (including ${files} attachment${files === 1 ? '' : 's'})` : 'Backup downloaded')
  } catch (err) {
    toast.error('Export failed: ' + (err?.message || 'unknown error'))
  } finally {
    exporting.value = false
  }
}

// Same exporter as the Expenses page (utils/csvExport.js): ALL expenses, newest first, category names, kind column.
function exportCSV() {
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]))
  const accountNames = Object.fromEntries(accounts.map((a) => [a.id, a.name]))
  const n = downloadTransactionsCsv(sortTransactions(expenses, 'newest'), { categoryNames: names, accountNames })
  toast.success(`Exported ${n} transaction${n === 1 ? '' : 's'}`)
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  triggerDownload(blob, filename)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// --- Import (parse + validate first, nothing is written until the user confirms) ---
const importState = ref(null) // { fileName, result, rows }
const importing = ref(false)

function handleFileSelect(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = parseBackup(String(reader.result))
    importState.value = { fileName: file.name, result, rows: result.ok ? summarizeBackup(result.backup) : [] }
  }
  reader.onerror = () => toast.error('Could not read that file')
  reader.readAsText(file)
}

async function confirmImport() {
  const state = importState.value
  if (!state?.result.ok || importing.value) return
  importing.value = true
  try {
    // Safety net first. If the snapshot store is unavailable, fall back to downloading a copy.
    const snapshot = await saveSnapshot('before-import').catch(() => null)
    if (!snapshot) {
      const current = await buildBackup({ includeAttachments: false })
      downloadJSON(current, `hisaab-before-import-${new Date().toISOString().slice(0, 10)}.json`)
      toast('Automatic snapshot unavailable, so a copy of your current data was downloaded instead')
    }
    const report = await applyBackup(state.result.backup)
    const extra = report.restoredAttachments ? `, ${report.restoredAttachments} attachment${report.restoredAttachments === 1 ? '' : 's'}` : ''
    toast.success(`Restored ${report.replaced.length} sections${extra}`)
    if (report.failedAttachments) toast.error(`${report.failedAttachments} attachment(s) could not be restored`)
    setTimeout(() => location.reload(), 700)
  } catch (err) {
    importing.value = false
    toast.error('Import failed. Your data was not changed. ' + (err?.message || ''))
  }
}

function cancelImport() {
  if (importing.value) return
  importState.value = null
}

// --- Safety snapshots ---
const snapshots = ref([])

async function refreshSnapshots() {
  try {
    snapshots.value = await listSnapshots()
  } catch {
    snapshots.value = []
  }
}

function downloadSnapshot(s) {
  downloadJSON(s.backup, `hisaab-snapshot-${s.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.json`)
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onMounted(refreshSnapshots)

// --- Receipts: what is stored, and a confirmed clean-up of files whose expense is gone ---
const receipts = ref({ count: 0, bytes: 0, orphans: [], orphanBytes: 0, missing: 0 })
const cleanupOpen = ref(false)
async function refreshReceipts() {
  try {
    receipts.value = receiptStats(expenses, await getAllAttachments())
  } catch {
    // IndexedDB unavailable: show nothing rather than an error
  }
}
onMounted(refreshReceipts)

// In an account: the files in the account that no receipt points at (a receipt removed, or an expense deleted), removed only after a confirmation, from Cloudinary too
const remote = ref(null) // { orphans, bytes } or null
const remoteOpen = ref(false)
async function refreshRemote() {
  if (!accountsOn || account.status !== 'signedIn') return
  try {
    remote.value = await receiptCleanup(false)
  } catch {
    remote.value = null // offline or not available: show nothing
  }
}
watch(() => account.status, refreshRemote)
onMounted(refreshRemote)
async function cleanUpRemote() {
  remoteOpen.value = false
  try {
    const r = await receiptCleanup(true)
    toast.success(r.removed === 1 ? 'Removed 1 unused file from your account' : `Removed ${r.removed} unused files from your account`)
  } catch {
    toast.error('That did not work. Try again when you are online.')
  }
  await refreshRemote()
}
async function cleanUpReceipts() {
  const ids = receipts.value.orphans.map((o) => o.id)
  cleanupOpen.value = false
  for (const id of ids) await deleteAttachment(id).catch(() => {})
  await refreshReceipts()
  toast.success(ids.length === 1 ? 'Removed 1 unused file' : `Removed ${ids.length} unused files`)
}

// --- Danger zone ---
const confirmPhrase = ref('')
const REQUIRED_PHRASE = 'DELETE MY DATA'
async function resetAllData() {
  if (confirmPhrase.value !== REQUIRED_PHRASE) return
  await clearSnapshots() // a reset must not leave a readable copy of the data behind
  await clearAllAttachments().catch(() => {}) // ...nor the stored bill files and receipts
  localStorage.clear()
  await deleteSyncDatabase().catch(() => {}) // and the sync memory of an account cache that no longer exists
  location.reload()
}

const usageKB = computed(() => (usageBytes() / 1024).toFixed(1))
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-4">
    <Card v-if="accountsOn" data-testid="account-card">
      <CardHeader><CardTitle class="text-base">Account</CardTitle></CardHeader>
      <CardContent class="flex flex-wrap items-center gap-3">
        <template v-if="account.status === 'signedIn' && account.profile">
          <UserAvatar :profile="account.profile" :size="40" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ account.profile.email }}</span>
          <Button variant="outline" size="sm" @click="router.push('/account')">Manage account</Button>
        </template>
        <template v-else>
          <p class="m-0 min-w-0 flex-1 text-sm text-muted-foreground">
            {{ account.status === 'offline' ? 'You seem to be offline.' : 'Your data stays on this device. An account is optional.' }}
          </p>
          <Button variant="outline" size="sm" @click="router.push('/account')">{{ account.status === 'signedOut' || account.status === 'idle' || account.status === 'loading' ? 'Sign in or create account' : 'Account' }}</Button>
        </template>
      </CardContent>
    </Card>

    <SyncCard />

    <Card>
      <CardHeader><CardTitle class="text-base">Profile</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-1.5">
        <Label>Name</Label>
        <Input v-model="profileName" type="text" class="max-w-64" @blur="saveProfile" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">Change password</CardTitle></CardHeader>
      <CardContent class="flex flex-wrap items-center gap-2">
        <Input v-model="currentPassword" type="password" placeholder="Current password" class="min-w-40 flex-1" />
        <Input v-model="newPassword" type="password" placeholder="New password" class="min-w-40 flex-1" />
        <Button @click="submitPasswordChange">Update</Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">Preferences</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Currency symbol</Label>
          <Input :model-value="settings.currencySymbol" type="text" class="max-w-20" @change="setCurrencySymbol($event.target.value)" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Cycle reset day</Label>
          <Input :model-value="settings.cycleResetDay" type="number" min="1" max="31" class="max-w-20" @change="setCycleResetDay($event.target.value)" />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">Manage</CardTitle></CardHeader>
      <CardContent class="flex gap-2">
        <Button variant="outline" @click="router.push('/categories')">Categories <ChevronRight class="h-4 w-4" /></Button>
        <Button variant="outline" @click="router.push('/budget')">Budget <ChevronRight class="h-4 w-4" /></Button>
      </CardContent>
    </Card>

    <Card v-if="canInstall || isInstalled">
      <CardHeader><CardTitle class="text-base">App</CardTitle></CardHeader>
      <CardContent class="flex items-center gap-3">
        <p v-if="isInstalled" class="m-0 text-sm text-muted-foreground">Hisaab is installed on this device.</p>
        <template v-else>
          <p class="m-0 flex-1 text-sm text-muted-foreground">Install Hisaab for quick access from your home screen and full offline use.</p>
          <Button variant="outline" @click="promptInstall"><MonitorDown class="h-4 w-4" /> Install app</Button>
        </template>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">Backup &amp; restore</CardTitle>
        <CardDescription>
          One file with all your data: expenses, income, budgets, bills, assets, lending, investments, vehicles and the (still encrypted) vault.
          The app-lock password is not included, so after restoring on a new device you set a new one. Your data only lives in this browser, so keep a backup somewhere safe.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox v-model="includeAttachments" />
          Include bill attachments (photos/PDFs). Makes the file larger.
        </label>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="exporting" @click="exportFull"><Download class="h-4 w-4" /> {{ exporting ? 'Preparing…' : 'Export full backup' }}</Button>
          <Button variant="outline" as="label" class="cursor-pointer">
            <Upload class="h-4 w-4" /> Import backup
            <input type="file" accept="application/json,.json" hidden @change="handleFileSelect" />
          </Button>
          <Button variant="outline" @click="exportCSV"><Download class="h-4 w-4" /> Export expenses (CSV)</Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="snapshots.length">
      <CardHeader>
        <CardTitle class="text-base">Safety snapshots</CardTitle>
        <CardDescription>Saved automatically before an import replaces your data. The latest {{ snapshots.length }} are kept on this device. Download one and use "Import backup" to go back.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <div v-for="s in snapshots" :key="s.id" class="flex items-center justify-between gap-2 text-sm">
          <span>{{ formatWhen(s.createdAt) }} <span class="text-muted-foreground">· {{ s.counts?.expenses ?? 0 }} expenses</span></span>
          <Button variant="ghost" size="sm" @click="downloadSnapshot(s)"><Download class="h-4 w-4" /> Download</Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">Storage</CardTitle></CardHeader>
      <CardContent>
        <p class="m-0 text-sm text-muted-foreground">{{ usageKB }} KB used (localStorage typically allows 5–10 MB per browser origin)</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">Receipts</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2" data-testid="receipts-card">
        <p class="m-0 text-sm text-muted-foreground" data-testid="receipts-summary">
          {{ receipts.count }} receipt file{{ receipts.count === 1 ? '' : 's' }} stored on this device ({{ formatBytes(receipts.bytes) }}). They are included in a backup when "include attachments" is ticked.
        </p>
        <p v-if="receipts.missing" class="m-0 text-sm text-status-warn">
          {{ receipts.missing }} receipt{{ receipts.missing === 1 ? ' is' : 's are' }} listed on an expense but the file is not on this device (for example after restoring a backup made without attachments).
        </p>
        <div v-if="receipts.orphans.length" class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground" data-testid="receipts-orphans">{{ receipts.orphans.length }} file{{ receipts.orphans.length === 1 ? '' : 's' }} ({{ formatBytes(receipts.orphanBytes) }}) belong to deleted expenses.</span>
          <Button variant="outline" size="sm" data-testid="receipts-cleanup" @click="cleanupOpen = true">Remove them</Button>
        </div>
        <p v-else class="m-0 text-xs text-muted-foreground">Deleting an expense keeps its receipts so that Undo always works. Anything left over would be listed here.</p>
        <div v-if="remote && remote.orphans > 0" class="flex flex-wrap items-center gap-2" data-testid="remote-orphans">
          <span class="text-sm text-muted-foreground">{{ remote.orphans }} file{{ remote.orphans === 1 ? '' : 's' }} ({{ formatBytes(remote.bytes) }}) in your account are not used by any receipt.</span>
          <Button variant="outline" size="sm" data-testid="remote-cleanup" @click="remoteOpen = true">Remove them</Button>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="remoteOpen" @update:open="(v) => (remoteOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {{ remote?.orphans }} unused file{{ remote?.orphans === 1 ? '' : 's' }} from your account?</DialogTitle>
          <DialogDescription>No receipt points at these files any more. This frees {{ formatBytes(remote?.bytes || 0) }} in your account and cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="remoteOpen = false">Cancel</Button>
          <Button variant="destructive" data-testid="remote-cleanup-confirm" @click="cleanUpRemote">Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="cleanupOpen" @update:open="(v) => (cleanupOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {{ receipts.orphans.length }} unused file{{ receipts.orphans.length === 1 ? '' : 's' }}?</DialogTitle>
          <DialogDescription>These receipts belong to expenses that no longer exist. This frees {{ formatBytes(receipts.orphanBytes) }} and cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="cleanupOpen = false">Cancel</Button>
          <Button variant="destructive" data-testid="receipts-cleanup-confirm" @click="cleanUpReceipts">Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Card class="border-destructive/50">
      <CardHeader><CardTitle class="text-base text-destructive">Danger zone</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="m-0 text-sm text-muted-foreground">Type "{{ REQUIRED_PHRASE }}" to permanently erase all local data.{{ accountsOn ? ' If you use an account, its copy in the account is not touched: sign in again to get it back.' : '' }}</p>
        <div class="flex flex-wrap gap-2">
          <Input v-model="confirmPhrase" type="text" :placeholder="REQUIRED_PHRASE" class="min-w-48 flex-1" />
          <Button variant="destructive" :disabled="confirmPhrase !== REQUIRED_PHRASE" @click="resetAllData">Reset all data</Button>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="!!importState" @update:open="(v) => !v && cancelImport()">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ importState?.result.ok ? 'Replace your data with this backup?' : "This file can't be imported" }}</DialogTitle>
        </DialogHeader>

        <template v-if="importState">
          <p class="m-0 break-all text-xs text-muted-foreground">{{ importState.fileName }}</p>

          <ul v-if="importState.result.errors.length" class="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">
            <li v-for="msg in importState.result.errors" :key="msg">{{ msg }}</li>
          </ul>

          <template v-if="importState.result.ok">
            <p v-if="importState.result.backup.exportedAt" class="m-0 text-sm text-muted-foreground">
              Backup taken {{ formatWhen(importState.result.backup.exportedAt) }}
            </p>
            <div class="overflow-hidden rounded-md border border-border text-sm">
              <div class="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Section</span><span>In backup</span><span>On this device</span>
              </div>
              <div v-for="row in importState.rows" :key="row.key" class="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-border px-3 py-1.5 last:border-b-0">
                <span>{{ row.label }}</span>
                <span class="amount text-right">{{ row.incoming }}</span>
                <span class="amount text-right text-muted-foreground">{{ row.current }}</span>
                <span v-if="row.note" class="col-span-3 text-xs text-status-warn">{{ row.note }}</span>
              </div>
            </div>
            <p v-if="importState.result.backup.attachments.length" class="m-0 text-sm">
              {{ importState.result.backup.attachments.length }} attachment(s) will be added.
            </p>
            <ul v-if="importState.result.warnings.length" class="m-0 flex list-disc flex-col gap-1 pl-5 text-xs text-status-warn">
              <li v-for="msg in importState.result.warnings" :key="msg">{{ msg }}</li>
            </ul>
            <p class="m-0 flex gap-2 text-sm">
              <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-status-warn" />
              <span>The sections above are <strong>replaced</strong> by the backup's version. Sections not listed stay as they are. A safety snapshot of your current data is saved first.</span>
            </p>
          </template>
        </template>

        <DialogFooter>
          <Button variant="ghost" :disabled="importing" @click="cancelImport">{{ importState?.result.ok ? 'Cancel' : 'Close' }}</Button>
          <Button v-if="importState?.result.ok" variant="destructive" :disabled="importing" @click="confirmImport">
            {{ importing ? 'Restoring…' : 'Replace my data' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
