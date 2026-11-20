<script setup>
import { cn } from '@/lib/utils.js'

defineProps({ class: { type: String, default: '' } })
const model = defineModel({ type: String, default: '' })
</script>

<template>
  <textarea
    v-model="model"
    :class="
      cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        $props.class
      )
    "
  />
</template>
