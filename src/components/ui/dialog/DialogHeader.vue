<script setup>
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <div :class="cn('flex flex-col gap-1.5 text-left', $props.class)"><slot /></div>
</template>
