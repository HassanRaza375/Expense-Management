<script setup>
import { computed } from 'vue'
import { formatDayKey } from '../utils/reporting.js'
import { useSettings } from '@/composables/useSettings.js'

// Net worth at the end of each month. points = [{ dayKey, total }].
const props = defineProps({
  points: { type: Array, required: true },
})

const { settings } = useSettings()

const series = computed(() => [{ name: 'Net worth', data: props.points.map((p) => p.total) }])

const chartOptions = computed(() => ({
  chart: { type: 'area', background: 'transparent', toolbar: { show: false }, zoom: { enabled: false } },
  stroke: { width: 3, curve: 'straight' },
  fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 100] } },
  xaxis: {
    categories: props.points.map((p) => formatDayKey(p.dayKey, { year: false })),
    labels: { style: { colors: 'var(--muted-foreground)' }, hideOverlappingLabels: true },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: { labels: { style: { colors: 'var(--muted-foreground)' }, formatter: (v) => Math.round(v).toLocaleString('en-US') } },
  grid: { borderColor: 'var(--border)' },
  colors: ['var(--primary)'],
  legend: { show: false },
  dataLabels: { enabled: false },
  markers: { size: 3 },
  tooltip: { theme: settings.theme, y: { formatter: (v) => settings.currencySymbol + ' ' + Math.round(v).toLocaleString('en-US') } },
}))
</script>

<template>
  <div class="flex min-h-60 items-center justify-center">
    <apexchart v-if="points.length > 1" type="area" height="260" :options="chartOptions" :series="series" />
    <div v-else class="text-sm text-muted-foreground">The trend appears after a second month of data</div>
  </div>
</template>
