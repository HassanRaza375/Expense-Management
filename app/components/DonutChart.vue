<script setup>
import { computed } from 'vue'
import { useSettings } from '@/composables/useSettings.js'

const props = defineProps({
  segments: {
    // [{ label, value, color }]
    type: Array,
    required: true,
  },
  emptyText: { type: String, default: 'No spending yet this cycle' },
})

const { settings } = useSettings()

const series = computed(() => props.segments.map((s) => s.value))
const labels = computed(() => props.segments.map((s) => s.label))
const colors = computed(() => props.segments.map((s) => s.color))

const chartOptions = computed(() => ({
  chart: { type: 'donut', background: 'transparent' },
  labels: labels.value,
  colors: colors.value,
  legend: { show: true, position: 'bottom', labels: { colors: 'var(--muted-foreground)' } },
  dataLabels: { enabled: false },
  stroke: { width: 0 },
  tooltip: { theme: settings.theme },
  plotOptions: {
    pie: {
      donut: {
        size: '68%',
        labels: {
          show: true,
          total: { show: true, label: 'Total', color: 'var(--muted-foreground)' },
        },
      },
    },
  },
}))
</script>

<template>
  <div class="flex min-h-70 items-center justify-center">
    <apexchart v-if="segments.length" type="donut" height="280" :options="chartOptions" :series="series" />
    <div v-else class="text-sm text-muted-foreground">{{ emptyText }}</div>
  </div>
</template>
