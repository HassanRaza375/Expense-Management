<script setup>
import { computed, ref, watch } from 'vue'
import { defaultAvatarUri } from '../lib/account/avatar'

// The user's own photo when there is one (and it loads), otherwise the generated geometric picture for this account. Offline the photo cannot load: the picture stays.
const props = defineProps({
  /** { id, email, avatarUrl } of the account, or null for a guest */
  profile: { type: Object, default: null },
  size: { type: Number, default: 40 },
})

const failed = ref(false)
watch(() => props.profile?.avatarUrl, () => (failed.value = false))

const seed = computed(() => props.profile?.id || props.profile?.email || 'guest')
const src = computed(() => (props.profile?.avatarUrl && !failed.value ? props.profile.avatarUrl : defaultAvatarUri(seed.value)))
</script>

<template>
  <img
    :src="src"
    :width="size"
    :height="size"
    alt=""
    class="shrink-0 rounded-full border border-border object-cover"
    :style="{ width: size + 'px', height: size + 'px' }"
    data-testid="user-avatar"
    @error="failed = true"
  />
</template>
