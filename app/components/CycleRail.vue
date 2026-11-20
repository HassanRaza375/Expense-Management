<script setup>
import { computed } from 'vue'
import { formatCycleLabel } from '../utils/date.js'
import { localDayKey, diffDays } from '../utils/reporting.js'
import { cycleDayProgress } from '../utils/budgetMath.js'

const props = defineProps({
  cycle: { type: Object, required: true }, // { start: Date, end: Date }
  isOverBudget: { type: Boolean, default: false },
  dueTicks: { type: Array, default: () => [] }, // array of Date
  today: { type: Date, default: () => new Date() },
})

// Whole LOCAL days via day keys (calendar math), never a difference of milliseconds, so a 23/25-hour DST day cannot
// shift "Day N of M".
const startKey = computed(() => localDayKey(props.cycle.start))
const progress = computed(() => cycleDayProgress({ startKey: startKey.value, endKey: localDayKey(props.cycle.end) }, localDayKey(props.today)))
const total = computed(() => progress.value.total)
const elapsed = computed(() => progress.value.elapsed)
const fillPercent = computed(() => Math.min((elapsed.value / total.value) * 100, 100))

function tickPercent(date) {
  const key = localDayKey(date)
  if (key === null) return 0
  const day = diffDays(startKey.value, key) + 1
  return Math.min(Math.max((day / total.value) * 100, 0), 100)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex justify-between text-sm text-muted-foreground">
      <span>{{ formatCycleLabel(cycle) }}</span>
      <span>Day {{ elapsed }} of {{ total }}</span>
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
