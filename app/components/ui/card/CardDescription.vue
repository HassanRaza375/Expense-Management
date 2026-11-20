<script setup>
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <p :class="cn('text-sm text-muted-foreground', $props.class)"><slot /></p>
</template>
