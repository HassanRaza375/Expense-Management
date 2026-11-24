<script setup>
import { TabsContent } from 'reka-ui'
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' }, value: { required: true } })
</script>

<template>
  <TabsContent :value="value" :class="cn('mt-4 focus-visible:outline-none', $props.class)">
    <slot />
  </TabsContent>
</template>
