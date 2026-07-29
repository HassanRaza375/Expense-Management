<script setup>
import { computed } from 'vue'
import { daysInCycle, daysElapsed, formatCycleLabel } from '../utils/date.js'

const props = defineProps({
  cycle: { type: Object, required: true },
  isOverBudget: { type: Boolean, default: false },
  dueTicks: { type: Array, default: () => [] }, // array of Date
  today: { type: Date, default: () => new Date() },
})

const total = computed(() => daysInCycle(props.cycle))
const elapsed = computed(() => daysElapsed(props.cycle, props.today))
const fillPercent = computed(() => Math.min((elapsed.value / total.value) * 100, 100))

function tickPercent(date) {
  const day = Math.floor((new Date(date) - props.cycle.start) / (24 * 60 * 60 * 1000)) + 1
  return Math.min(Math.max((day / total.value) * 100, 0), 100)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex justify-between text-sm text-muted-foreground">
      <span>{{ formatCycleLabel(cycle) }}</span>
      <span>Day {{ Math.min(elapsed, total) }} of {{ total }}</span>
    </div>
    <div class="relative h-3.5 rounded-full border border-border bg-secondary">
      <div
        class="h-full rounded-full transition-all duration-300 ease-out"
        :class="isOverBudget ? 'bg-status-over' : 'bg-primary'"
        :style="{ width: fillPercent + '%' }"
      />
      <div
        v-for="(tick, idx) in dueTicks"
        :key="idx"
        class="absolute -top-1.5 h-6.5 w-0.5 -translate-x-1/2 rounded-sm bg-status-warn"
        :style="{ left: tickPercent(tick) + '%' }"
        title="Recurring due"
      />
      <div
        class="absolute -top-0.5 h-5 w-0.5 -translate-x-1/2 rounded-sm bg-foreground"
        :style="{ left: fillPercent + '%' }"
      />
    </div>
  </div>
</template>
