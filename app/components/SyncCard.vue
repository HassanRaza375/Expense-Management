<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import { useSync, syncNow, confirmHeld, restoreFromAccount, undoUpload } from '../composables/useSync'

// Sync, in plain words: is my data safe in my account, what is waiting, and what needs a decision. Account mode only.
const sync = useSync()
const router = useRouter()
const busy = ref(false)

const active = computed(() => sync.status !== 'off' && sync.status !== 'guest')
const when = computed(() => (sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'not yet'))
const headline = computed(() => {
  switch (sync.status) {
    case 'syncing':
      return 'Syncing now...'
    case 'synced':
      return 'Everything on this device is in your account.'
    case 'offline':
      return sync.pending ? `Offline. ${sync.pending} change${sync.pending === 1 ? '' : 's'} saved here, waiting to go up.` : 'Offline. Nothing is waiting.'
    case 'held':
      return 'Waiting for you: a very large deletion.'
    default:
      return sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to go up.` : 'Up to date.'
  }
})

async function guarded(fn, done) {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
    if (done) toast(done)
  } catch {
    toast.error('That did not work. Try again.')
  } finally {
    busy.value = false
  }
}

async function undo() {
  await guarded(async () => {
    const n = await undoUpload()
    toast(`Removed ${n} uploaded record${n === 1 ? '' : 's'} from your account`)
  })
}
</script>

<template>
  <Card v-if="active" data-testid="sync-card">
    <CardHeader>
      <CardTitle class="text-base">Sync</CardTitle>
      <CardDescription>Your data lives in your account and is kept on this device so Hisaab works offline.</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 text-sm">
      <p class="m-0" data-testid="sync-headline">{{ headline }}</p>
      <p class="m-0 text-xs text-muted-foreground">Last synced: {{ when }}</p>
      <p v-if="sync.message" class="m-0 text-sm" :class="sync.status === 'error' || sync.status === 'signedOut' || sync.status === 'mismatch' ? 'text-destructive' : 'text-muted-foreground'" data-testid="sync-message" role="status">{{ sync.message }}</p>

      <p v-if="sync.uploads.total > sync.uploads.done + sync.uploads.failed" class="m-0 text-xs text-muted-foreground" data-testid="receipt-progress">Uploading receipts: {{ sync.uploads.done }} of {{ sync.uploads.total }}</p>
      <p v-if="sync.uploads.message" class="m-0 text-xs text-status-warn" data-testid="receipt-upload-message" role="status">{{ sync.uploads.message }}</p>

      <div v-if="sync.held" class="flex flex-col gap-2 rounded-md border border-status-warn/50 p-3" data-testid="sync-held">
        <p class="m-0">This device is about to delete {{ sync.held.deletes }} of the {{ sync.held.of }} records in your account. That is more than usual, so nothing was sent.</p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" :disabled="busy" data-testid="held-restore" @click="guarded(restoreFromAccount)">Restore from my account</Button>
          <Button variant="destructive" size="sm" :disabled="busy" data-testid="held-confirm" @click="guarded(confirmHeld, 'Deletions sent')">Delete them from my account too</Button>
        </div>
      </div>

      <div v-if="sync.uploaded > 0" class="flex flex-wrap items-center gap-2" data-testid="sync-undo">
        <span class="text-xs text-muted-foreground">{{ sync.uploaded }} records were uploaded from this device.</span>
        <Button variant="ghost" size="sm" :disabled="busy" @click="undo">Undo the upload</Button>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" :disabled="busy || sync.status === 'syncing'" data-testid="sync-now" @click="syncNow()">Sync now</Button>
        <Button v-if="sync.status === 'signedOut' || sync.status === 'mismatch'" size="sm" @click="router.push('/account')">Sign in</Button>
      </div>

      <p class="m-0 text-xs text-muted-foreground">Receipts go to your account too, as private files that only you can open. Bill files stay on this device. The app lock and the theme are never synced. The Vault is synced only as the encrypted text it already is.</p>
    </CardContent>
  </Card>
</template>
