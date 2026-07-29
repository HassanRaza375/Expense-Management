<script setup>
import { DialogDescription } from 'reka-ui'
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <DialogDescription :class="cn('text-sm text-muted-foreground', $props.class)"><slot /></DialogDescription>
</template>
