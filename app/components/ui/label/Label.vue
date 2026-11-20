<script setup>
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <label :class="cn('text-xs font-medium text-muted-foreground select-none', $props.class)">
    <slot />
  </label>
</template>
