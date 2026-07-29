<script setup>
import { cn } from '@/lib/utils.js'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  status: { type: String, default: '' }, // '', 'good', 'warn', 'over'
  class: { type: String, default: '' },
})

const statusClass = {
  good: 'bg-status-good',
  warn: 'bg-status-warn',
  over: 'bg-status-over',
  '': 'bg-primary',
}
</script>

<template>
  <div :class="cn('relative h-2.5 w-full overflow-hidden rounded-full bg-secondary border border-border', props.class)">
    <div
      class="h-full rounded-full transition-all duration-300 ease-out"
      :class="statusClass[status] || statusClass['']"
      :style="{ width: Math.min(Math.max(modelValue, 0), 100) + '%' }"
    />
  </div>
</template>
