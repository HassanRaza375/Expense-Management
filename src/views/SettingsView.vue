<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Download, Upload, ChevronRight, MonitorDown } from '@lucide/vue'
import { useSettings } from '../composables/useSettings.js'
import { useAppLock } from '../composables/useAppLock.js'
import { useInstallPrompt } from '../composables/useInstallPrompt.js'
import { get, set, usageBytes, STORAGE_KEYS } from '../utils/storage.js'
import { useExpenses } from '../composables/useExpenses.js'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const router = useRouter()

const { settings, updateProfile, setCurrencySymbol, setCycleResetDay } = useSettings()
const { changePassword } = useAppLock()
const { expenses } = useExpenses()
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

// --- Main backup ---
function exportMain() {
  const bundle = {
    kind: 'hisaab-main-backup',
    exportedAt: new Date().toISOString(),
    settings: get(STORAGE_KEYS.SETTINGS, {}),
    categories: get(STORAGE_KEYS.CATEGORIES, []),
    expenses: get(STORAGE_KEYS.EXPENSES, []),
    recurring: get(STORAGE_KEYS.RECURRING, []),
    bills: get(STORAGE_KEYS.BILLS, { connections: [], bills: [] }),
    income: get(STORAGE_KEYS.INCOME, []),
    vehicles: get(STORAGE_KEYS.VEHICLES, []),
    vehicleLogs: get(STORAGE_KEYS.VEHICLE_LOGS, []),
    fuelLogs: get(STORAGE_KEYS.FUEL_LOGS, []),
    lending: get(STORAGE_KEYS.LENDING, []),
    meterReadings: get(STORAGE_KEYS.METER_READINGS, []),
    investments: get(STORAGE_KEYS.INVESTMENTS, []),
  }
  downloadJSON(bundle, `hisaab-backup-${new Date().toISOString().slice(0, 10)}.json`)
}

function exportVaultAssets() {
  const bundle = {
    kind: 'hisaab-vault-assets-backup',
    exportedAt: new Date().toISOString(),
    vault: get(STORAGE_KEYS.VAULT, null), // still encrypted
    assets: get(STORAGE_KEYS.ASSETS, []),
  }
  downloadJSON(bundle, `hisaab-vault-assets-${new Date().toISOString().slice(0, 10)}.json`)
}

function exportCSV() {
  const header = 'date,amount,category,note,source\n'
  const rows = expenses
    .map((e) => [e.date, e.amount, e.categoryId, `"${(e.note || '').replace(/"/g, '""')}"`, e.source].join(','))
    .join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv' })
  triggerDownload(blob, `hisaab-expenses-${new Date().toISOString().slice(0, 10)}.csv`)
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

const importPreview = ref(null)
const importKind = ref('')

function handleFileSelect(e, kind) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result)
      importKind.value = kind
      importPreview.value = parsed
    } catch {
      toast.error('Invalid JSON file')
    }
  }
  reader.readAsText(file)
  e.target.value = ''
}

function confirmImport() {
  const data = importPreview.value
  if (importKind.value === 'main') {
    if (data.settings) set(STORAGE_KEYS.SETTINGS, data.settings)
    if (data.categories) set(STORAGE_KEYS.CATEGORIES, data.categories)
    if (data.expenses) set(STORAGE_KEYS.EXPENSES, data.expenses)
    if (data.recurring) set(STORAGE_KEYS.RECURRING, data.recurring)
    if (data.bills) set(STORAGE_KEYS.BILLS, data.bills)
    if (data.income) set(STORAGE_KEYS.INCOME, data.income)
    if (data.vehicles) set(STORAGE_KEYS.VEHICLES, data.vehicles)
    if (data.vehicleLogs) set(STORAGE_KEYS.VEHICLE_LOGS, data.vehicleLogs)
    if (data.fuelLogs) set(STORAGE_KEYS.FUEL_LOGS, data.fuelLogs)
    if (data.lending) set(STORAGE_KEYS.LENDING, data.lending)
    if (data.meterReadings) set(STORAGE_KEYS.METER_READINGS, data.meterReadings)
    if (data.investments) set(STORAGE_KEYS.INVESTMENTS, data.investments)
  } else if (importKind.value === 'vault') {
    if (data.vault) set(STORAGE_KEYS.VAULT, data.vault)
    if (data.assets) set(STORAGE_KEYS.ASSETS, data.assets)
  }
  importPreview.value = null
  location.reload()
}

function cancelImport() {
  importPreview.value = null
}

const importSummary = computed(() => {
  const d = importPreview.value
  if (!d) return []
  if (importKind.value === 'main') {
    return [
      `Categories: ${d.categories?.length ?? 0}`,
      `Expenses: ${d.expenses?.length ?? 0}`,
      `Recurring: ${d.recurring?.length ?? 0}`,
      `Bills: ${d.bills?.bills?.length ?? 0} (connections: ${d.bills?.connections?.length ?? 0})`,
      `Settings: ${d.settings ? 'included' : 'missing'}`,
    ]
  }
  return [`Vault: ${d.vault ? 'included (encrypted)' : 'missing'}`, `Assets: ${d.assets?.length ?? 0}`]
})

// --- Danger zone ---
const confirmPhrase = ref('')
const REQUIRED_PHRASE = 'DELETE MY DATA'
function resetAllData() {
  if (confirmPhrase.value !== REQUIRED_PHRASE) return
  localStorage.clear()
  location.reload()
}

const usageKB = computed(() => (usageBytes() / 1024).toFixed(1))
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-4">
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
        <CardTitle class="text-base">Backup — main data</CardTitle>
        <CardDescription>Settings, Categories, Expenses, Recurring, Budget, Bills. (Bill attachments live in IndexedDB and aren't included — device-local only.)</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap gap-2">
        <Button variant="outline" @click="exportMain"><Download class="h-4 w-4" /> Export JSON</Button>
        <Button variant="outline" @click="exportCSV"><Download class="h-4 w-4" /> Export CSV (expenses)</Button>
        <Button variant="outline" as="label" class="cursor-pointer">
          <Upload class="h-4 w-4" /> Import JSON
          <input type="file" accept="application/json" hidden @change="handleFileSelect($event, 'main')" />
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">Backup — Vault &amp; Assets</CardTitle>
        <CardDescription>Separate file. Vault portion stays encrypted, safe to store without the passphrase.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap gap-2">
        <Button variant="outline" @click="exportVaultAssets"><Download class="h-4 w-4" /> Export JSON</Button>
        <Button variant="outline" as="label" class="cursor-pointer">
          <Upload class="h-4 w-4" /> Import JSON
          <input type="file" accept="application/json" hidden @change="handleFileSelect($event, 'vault')" />
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-base">Storage</CardTitle></CardHeader>
      <CardContent>
        <p class="m-0 text-sm text-muted-foreground">{{ usageKB }} KB used (localStorage typically allows 5–10 MB per browser origin)</p>
      </CardContent>
    </Card>

    <Card class="border-destructive/50">
      <CardHeader><CardTitle class="text-base text-destructive">Danger zone</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="m-0 text-sm text-muted-foreground">Type "{{ REQUIRED_PHRASE }}" to permanently erase all local data.</p>
        <div class="flex flex-wrap gap-2">
          <Input v-model="confirmPhrase" type="text" :placeholder="REQUIRED_PHRASE" class="min-w-48 flex-1" />
          <Button variant="destructive" :disabled="confirmPhrase !== REQUIRED_PHRASE" @click="resetAllData">Reset all data</Button>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="!!importPreview" @update:open="(v) => !v && cancelImport()">
      <DialogContent class="max-w-sm">
        <DialogHeader><DialogTitle>Confirm import</DialogTitle></DialogHeader>
        <ul class="m-0 list-disc pl-5 text-sm">
          <li v-for="line in importSummary" :key="line">{{ line }}</li>
        </ul>
        <p class="m-0 text-sm text-muted-foreground">This will overwrite existing data for these keys.</p>
        <DialogFooter>
          <Button variant="ghost" @click="cancelImport">Cancel</Button>
          <Button @click="confirmImport">Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
