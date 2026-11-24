<script setup>
import { ref } from 'vue'
import { Eye } from '@lucide/vue'

const props = defineProps({
  value: { type: String, default: '' },
  visibleTail: { type: Number, default: 4 },
})

const revealed = ref(false)
let hideTimer = null

function masked() {
  if (!props.value) return '—'
  const tail = props.value.slice(-props.visibleTail)
  return `•••• •••• •••• ${tail}`
}

function reveal() {
  revealed.value = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    revealed.value = false
  }, 4000)
}
</script>

<template>
  <button
    type="button"
    class="amount inline-flex items-center gap-1.5 rounded-md border border-input bg-secondary px-2 py-1 text-sm tracking-wide transition-colors hover:border-primary"
    @click="reveal"
  >
    {{ revealed ? value : masked() }}
    <Eye class="h-3.5 w-3.5 text-muted-foreground" />
  </button>
</template>
