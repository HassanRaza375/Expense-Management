<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Cloud, CloudOff, RefreshCw, TriangleAlert } from '@lucide/vue'
import { Button } from '@/components/ui/button/index.js'
import { useSync, syncNow } from '../composables/useSync'

// The small "am I safe?" indicator in the header. Only in account mode (nothing in guest mode). Always says in words what is happening; the icon is a hint.
const sync = useSync()
const router = useRouter()

const NEEDS_ATTENTION = ['error', 'signedOut', 'mismatch', 'disabled', 'updateRequired', 'held']
const visible = computed(() => sync.status !== 'off' && sync.status !== 'guest')
const attention = computed(() => NEEDS_ATTENTION.includes(sync.status))

const label = computed(() => {
  const n = sync.pending
  switch (sync.status) {
    case 'syncing':
      return 'Syncing...'
    case 'synced':
      return 'Synced'
    case 'offline':
      return n ? `Offline, ${n} waiting` : 'Offline'
    case 'error':
      return 'Sync problem'
    case 'signedOut':
      return 'Sign in to sync'
    case 'mismatch':
      return 'Wrong account'
    case 'disabled':
      return 'Account disabled'
    case 'updateRequired':
      return 'Update needed'
    case 'held':
      return 'Check deletions'
    default:
      return n ? `${n} waiting` : 'Synced'
  }
})

function press() {
  if (attention.value) router.push('/settings')
  else syncNow()
}
</script>

<template>
  <Button v-if="visible" variant="ghost" size="sm" class="gap-1.5 text-muted-foreground" :data-testid="'sync-status'" :data-status="sync.status" :title="sync.message || label" @click="press">
    <RefreshCw v-if="sync.status === 'syncing'" class="h-4 w-4 animate-spin" aria-hidden="true" />
    <CloudOff v-else-if="sync.status === 'offline'" class="h-4 w-4" aria-hidden="true" />
    <TriangleAlert v-else-if="attention" class="h-4 w-4 text-status-warn" aria-hidden="true" />
    <Cloud v-else class="h-4 w-4" aria-hidden="true" />
    <span class="text-xs" role="status" aria-live="polite">{{ label }}</span>
  </Button>
</template>
