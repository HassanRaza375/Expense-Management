<script setup>
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <h3 :class="cn('font-display text-lg font-semibold leading-none', $props.class)"><slot /></h3>
</template>
