<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Cloud, CloudOff, LogOut, Trash2, ImagePlus } from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import UserAvatar from '../components/UserAvatar.vue'
import AvatarCropDialog from '../components/AvatarCropDialog.vue'
import { friendly } from '../lib/account/api'
import { accountsEnabled, useAccount, refresh, signIn, signUp, signOut, signInWithGoogle, updateName, changePassword, uploadAvatar, removeAvatar, deleteAccount } from '../composables/useAccount'

// Your account. Guest mode (no account) is the app as it always was: everything stays on this device. An account is optional.
const router = useRouter()
const account = useAccount()
const enabled = accountsEnabled()

onMounted(() => {
  if (!enabled) {
    router.replace('/settings') // accounts are not turned on in this build: this page does not exist
    return
  }
  refresh()
})

const busy = ref(false)
const message = ref('')
const messageKind = ref('error')
function fail(e) {
  messageKind.value = 'error'
  message.value = friendly(e)
}
function note(text) {
  messageKind.value = 'info'
  message.value = text
}
async function guarded(fn) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    await fn()
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}

// --- signed out: sign in / create account ---
const mode = ref('signIn') // 'signIn' | 'signUp'
const form = ref({ name: '', email: '', password: '' })
watch(mode, () => (message.value = ''))

const canSubmit = computed(() => form.value.email.trim() && form.value.password && (mode.value === 'signIn' || (form.value.name.trim() && form.value.password.length >= account.features.passwordMin)))

function submit() {
  if (!canSubmit.value) return
  guarded(async () => {
    if (mode.value === 'signIn') {
      await signIn(form.value.email, form.value.password)
    } else {
      const r = await signUp(form.value.name, form.value.email, form.value.password)
      if (r.needsVerification) note('Account created. Open the message we sent to your email address to confirm it, then sign in.')
    }
    form.value.password = ''
  })
}

// --- signed in ---
const nameDraft = ref('')
watch(
  () => account.profile?.name,
  (n) => (nameDraft.value = n ?? ''),
  { immediate: true }
)
const nameChanged = computed(() => nameDraft.value.trim() && nameDraft.value.trim() !== account.profile?.name)
function saveName() {
  guarded(async () => {
    await updateName(nameDraft.value)
    toast('Name saved')
  })
}

const fileInput = ref(null)
const pickedFile = ref(null)
function onPick(e) {
  const f = e.target.files?.[0]
  e.target.value = '' // the same file can be chosen again
  if (!f) return
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
    messageKind.value = 'error'
    message.value = 'Choose a JPEG, PNG or WebP picture.'
    return
  }
  message.value = ''
  pickedFile.value = f
}
function savePhoto(blob) {
  pickedFile.value = null
  guarded(async () => {
    await uploadAvatar(blob)
    toast('Photo saved')
  })
}
function dropPhoto() {
  guarded(async () => {
    await removeAvatar()
    toast('Photo removed')
  })
}

const pw = ref({ current: '', next: '' })
function savePassword() {
  guarded(async () => {
    await changePassword(pw.value.current, pw.value.next)
    pw.value = { current: '', next: '' }
    toast('Password changed. Other devices were signed out.')
  })
}

function leave() {
  guarded(async () => {
    await signOut()
    toast('Signed out. The data on this device is still here.')
  })
}

const confirmEmail = ref('')
const canDelete = computed(() => account.profile && confirmEmail.value.trim().toLowerCase() === account.profile.email.toLowerCase())
function removeAccount() {
  if (!canDelete.value) return
  guarded(async () => {
    await deleteAccount(confirmEmail.value)
    confirmEmail.value = ''
    toast('Account deleted. The data on this device is still here.')
  })
}
</script>

<template>
  <div v-if="enabled" class="flex max-w-2xl flex-col gap-4">
    <p v-if="account.status === 'loading' || account.status === 'idle'" class="m-0 text-sm text-muted-foreground" data-testid="account-loading">Checking your account...</p>

    <Card v-else-if="account.status === 'offline' || account.status === 'unavailable'" data-testid="account-unreachable">
      <CardContent class="flex items-start gap-3 pt-6">
        <CloudOff class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div class="flex flex-col gap-2">
          <p class="m-0 text-sm">
            {{ account.status === 'offline' ? 'You seem to be offline, so your account cannot be reached.' : 'The account service is not available right now.' }}
            Hisaab keeps working on this device with everything you have saved here.
          </p>
          <div><Button variant="outline" size="sm" @click="refresh()">Try again</Button></div>
        </div>
      </CardContent>
    </Card>

    <!-- signed out -->
    <template v-else-if="account.status === 'signedOut'">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base"><Cloud class="h-4 w-4" /> Use an account</CardTitle>
          <CardDescription>You do not need one. Without an account everything stays on this device only. An account will keep your data safe in one place for all your devices.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="inline-flex w-fit rounded-md border border-border p-0.5" role="group" aria-label="Sign in or create an account">
            <Button :variant="mode === 'signIn' ? 'default' : 'ghost'" size="sm" :aria-pressed="mode === 'signIn'" data-testid="mode-sign-in" @click="mode = 'signIn'">Sign in</Button>
            <Button :variant="mode === 'signUp' ? 'default' : 'ghost'" size="sm" :aria-pressed="mode === 'signUp'" data-testid="mode-sign-up" @click="mode = 'signUp'">Create account</Button>
          </div>

          <form class="flex flex-col gap-3" data-testid="auth-form" @submit.prevent="submit">
            <div v-if="mode === 'signUp'" class="flex flex-col gap-1.5">
              <Label for="acc-name">Name</Label>
              <Input id="acc-name" v-model="form.name" type="text" autocomplete="name" maxlength="80" />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="acc-email">Email</Label>
              <Input id="acc-email" v-model="form.email" type="email" autocomplete="email" inputmode="email" />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="acc-password">Password</Label>
              <Input id="acc-password" v-model="form.password" type="password" :autocomplete="mode === 'signIn' ? 'current-password' : 'new-password'" maxlength="128" />
              <p v-if="mode === 'signUp'" class="m-0 text-xs text-muted-foreground">At least {{ account.features.passwordMin }} characters. There is no way to recover it unless email reset is available (see below).</p>
            </div>
            <p v-if="message" class="m-0 text-sm" :class="messageKind === 'error' ? 'text-destructive' : 'text-foreground'" :role="messageKind === 'error' ? 'alert' : 'status'" data-testid="auth-message">{{ message }}</p>
            <div>
              <Button type="submit" :disabled="!canSubmit || busy" data-testid="auth-submit">{{ busy ? 'Please wait...' : mode === 'signIn' ? 'Sign in' : 'Create account' }}</Button>
            </div>
          </form>

          <div class="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" :disabled="!account.features.google || busy" data-testid="google-button" @click="guarded(signInWithGoogle)">Continue with Google</Button>
              <span v-if="!account.features.google" class="text-xs text-muted-foreground" data-testid="google-off">Not available yet.</span>
            </div>
            <p v-if="!account.features.email" class="m-0 text-xs text-muted-foreground" data-testid="email-off">
              Email is not set up yet, so your address is not confirmed and a forgotten password cannot be reset by email. Keep your password somewhere safe.
            </p>
          </div>
        </CardContent>
      </Card>
    </template>

    <!-- signed in -->
    <template v-else-if="account.status === 'signedIn' && account.profile">
      <Card>
        <CardHeader><CardTitle class="text-base">Profile</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-4">
            <UserAvatar :profile="account.profile" :size="72" />
            <div class="flex min-w-0 flex-col gap-1">
              <span class="truncate text-sm font-medium" data-testid="account-email">{{ account.profile.email }}</span>
              <Badge v-if="account.profile.role === 'superadmin'" variant="secondary" class="w-fit">Super admin</Badge>
              <div class="flex flex-wrap gap-2 pt-1">
                <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-label="Choose a profile photo" data-testid="photo-input" @change="onPick" />
                <Button variant="outline" size="sm" :disabled="busy" data-testid="photo-change" @click="fileInput.click()"><ImagePlus class="mr-1.5 h-4 w-4" /> {{ account.profile.avatarUrl ? 'Change photo' : 'Add photo' }}</Button>
                <Button v-if="account.profile.avatarUrl" variant="ghost" size="sm" :disabled="busy" data-testid="photo-remove" @click="dropPhoto">Remove photo</Button>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="acc-display-name">Name</Label>
            <div class="flex flex-wrap gap-2">
              <Input id="acc-display-name" v-model="nameDraft" type="text" maxlength="80" class="max-w-64" />
              <Button variant="outline" :disabled="!nameChanged || busy" data-testid="name-save" @click="saveName">Save</Button>
            </div>
          </div>
          <p v-if="message" class="m-0 text-sm" :class="messageKind === 'error' ? 'text-destructive' : 'text-foreground'" :role="messageKind === 'error' ? 'alert' : 'status'" data-testid="account-message">{{ message }}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">Password</CardTitle></CardHeader>
        <CardContent>
          <form class="flex flex-col gap-3" @submit.prevent="savePassword">
            <div class="flex flex-wrap gap-3">
              <div class="flex flex-col gap-1.5">
                <Label for="acc-pw-current">Current password</Label>
                <Input id="acc-pw-current" v-model="pw.current" type="password" autocomplete="current-password" maxlength="128" class="w-56" />
              </div>
              <div class="flex flex-col gap-1.5">
                <Label for="acc-pw-new">New password</Label>
                <Input id="acc-pw-new" v-model="pw.next" type="password" autocomplete="new-password" maxlength="128" class="w-56" />
              </div>
            </div>
            <div><Button type="submit" variant="outline" :disabled="!pw.current || pw.next.length < account.features.passwordMin || busy" data-testid="password-save">Change password</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">Sign out</CardTitle><CardDescription>Ends the session on this device. The data on this device stays.</CardDescription></CardHeader>
        <CardContent><Button variant="outline" :disabled="busy" data-testid="sign-out" @click="leave"><LogOut class="mr-1.5 h-4 w-4" /> Sign out</Button></CardContent>
      </Card>

      <Card class="border-destructive/50">
        <CardHeader>
          <CardTitle class="text-base text-destructive">Delete account</CardTitle>
          <CardDescription>Removes your account and everything stored for it on the server, including your profile photo. The data saved on this device is not deleted. This cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <Label for="acc-confirm">Type your email address ({{ account.profile.email }}) to confirm</Label>
          <div class="flex flex-wrap gap-2">
            <Input id="acc-confirm" v-model="confirmEmail" type="email" autocomplete="off" class="max-w-72" data-testid="delete-confirm" />
            <Button variant="destructive" :disabled="!canDelete || busy" data-testid="delete-account" @click="removeAccount"><Trash2 class="mr-1.5 h-4 w-4" /> Delete account</Button>
          </div>
        </CardContent>
      </Card>

      <AvatarCropDialog :open="!!pickedFile" :file="pickedFile" @close="pickedFile = null" @save="savePhoto" />
    </template>
  </div>
</template>
