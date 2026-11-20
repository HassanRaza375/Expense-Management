<script setup>
import { DialogTitle } from 'reka-ui'
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <DialogTitle :class="cn('font-display text-lg font-semibold', $props.class)"><slot /></DialogTitle>
</template>
