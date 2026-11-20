<script setup>
import { ref, computed } from 'vue'
import { useAppLock } from '../composables/useAppLock.js'
import { useSettings } from '../composables/useSettings.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Card, CardContent } from '@/components/ui/card/index.js'

const { state, setPassword, tryUnlock } = useAppLock()
const { settings } = useSettings()

const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const showRecoveryInfo = ref(false)

const initials = computed(() => {
  const name = settings.profileName || 'You'
  return name.trim().slice(0, 1).toUpperCase()
})

async function submit() {
  error.value = ''
  if (state.isFirstRun) {
    if (password.value.length < 4) {
      error.value = 'Password must be at least 4 characters'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = 'Passwords do not match'
      return
    }
    await setPassword(password.value)
  } else {
    const ok = await tryUnlock(password.value)
    if (!ok) {
      error.value = 'Incorrect password'
      password.value = ''
    }
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-5">
    <Card class="w-full max-w-sm">
      <CardContent class="flex flex-col items-center gap-3 p-8 text-center">
        <div class="flex h-18 w-18 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground">
          <img v-if="settings.profileAvatar" :src="settings.profileAvatar" alt="" class="h-full w-full object-cover" />
          <span v-else class="font-display text-2xl">{{ initials }}</span>
        </div>
        <h1 class="font-display text-xl">{{ settings.profileName }}</h1>
        <p class="m-0 text-sm text-muted-foreground">
          {{ state.isFirstRun ? 'Set a password to protect Hisaab' : 'Enter your password to continue' }}
        </p>

        <form class="mt-2 flex w-full flex-col gap-3" @submit.prevent="submit">
          <div class="flex flex-col gap-1.5 text-left">
            <Label>Password</Label>
            <Input v-model="password" type="password" autofocus placeholder="••••••••" />
          </div>
          <div v-if="state.isFirstRun" class="flex flex-col gap-1.5 text-left">
            <Label>Confirm password</Label>
            <Input v-model="confirmPassword" type="password" placeholder="••••••••" />
          </div>
          <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
          <Button type="submit" class="w-full" size="lg">
            {{ state.isFirstRun ? 'Set password & continue' : 'Unlock' }}
          </Button>
        </form>

        <button type="button" class="mt-2 text-xs text-muted-foreground underline" @click="showRecoveryInfo = !showRecoveryInfo">
          Forgot password?
        </button>
        <p v-if="showRecoveryInfo" class="text-xs leading-relaxed text-muted-foreground">
          There's no recovery path — Hisaab has no server. Restore from a previous export, or clear site data
          to start over (this loses anything not backed up).
        </p>
      </CardContent>
    </Card>
  </div>
</template>
