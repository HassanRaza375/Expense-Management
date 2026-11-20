<script setup>
import { TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/utils.js'
defineProps({ class: { type: String, default: '' }, value: { required: true } })
</script>

<template>
  <TabsTrigger
    :value="value"
    :class="
      cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        $props.class
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
