<script setup>
import { TabsList } from 'reka-ui'
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <TabsList :class="cn('inline-flex h-9 items-center gap-1 rounded-md bg-secondary p-1 text-muted-foreground', $props.class)">
    <slot />
  </TabsList>
</template>
