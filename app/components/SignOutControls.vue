<script setup>
import { ref } from 'vue'
import { LogOut } from '@lucide/vue'
import { Button } from '@/components/ui/button/index.js'
import { signOutEverywhere } from '../composables/useSync'

// Sign out. In account mode this removes the account's copy from this device (the account keeps its own). If changes have not reached the account yet (for example because
// the device is offline) it says so and asks first: signing out then would lose them. Works offline too, which is exactly when it matters.
const busy = ref(false)
const blocked = ref(0)

async function leave(discard = false) {
  if (busy.value) return
  busy.value = true
  try {
    const r = await signOutEverywhere({ discard })
    blocked.value = r.blocked
  } catch {
    blocked.value = 0
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="blocked" class="flex flex-col gap-2 rounded-md border border-destructive/50 p-3" data-testid="leave-blocked" role="alert">
      <p class="m-0 text-sm">{{ blocked }} change{{ blocked === 1 ? ' has' : 's have' }} not reached your account yet (you may be offline). Signing out now would lose {{ blocked === 1 ? 'it' : 'them' }}.</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" data-testid="leave-stay" @click="blocked = 0">Stay signed in</Button>
        <Button variant="destructive" size="sm" :disabled="busy" data-testid="leave-anyway" @click="leave(true)">Sign out anyway</Button>
      </div>
    </div>
    <div>
      <Button variant="outline" :disabled="busy" data-testid="sign-out" @click="leave(false)"><LogOut class="mr-1.5 h-4 w-4" /> Sign out</Button>
    </div>
  </div>
</template>
