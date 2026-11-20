<script setup>
import { cn } from '@/lib/utils.js'
import { Card, CardContent } from '@/components/ui/card/index.js'

defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  sub: { type: String, default: '' },
  status: { type: String, default: '' }, // '', 'good', 'warn', 'over'
  icon: { type: [Object, Function], default: null },
})

const statusTextClass = {
  good: 'text-status-good',
  warn: 'text-status-warn',
  over: 'text-status-over',
  '': 'text-foreground',
}
</script>

<template>
  <Card>
    <CardContent class="flex min-w-0 flex-col gap-1 p-4">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ label }}</span>
        <component :is="icon" v-if="icon" class="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div :class="cn('amount overflow-hidden text-ellipsis text-2xl font-semibold', statusTextClass[status] || statusTextClass[''])">
        {{ value }}
      </div>
      <div v-if="sub" class="text-xs text-muted-foreground">{{ sub }}</div>
    </CardContent>
  </Card>
</template>
