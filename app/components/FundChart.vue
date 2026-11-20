<script setup>
import { computed } from 'vue'
import { formatDayKey } from '../utils/reporting.js'
import { useSettings } from '@/composables/useSettings.js'

// "Value vs money put in" for one fund. points = fundSeries(fund): [{ dayKey, value, netInvested }].
const props = defineProps({
  points: { type: Array, required: true },
})

const { settings } = useSettings()

const series = computed(() => [
  { name: 'Value', data: props.points.map((p) => p.value) },
  { name: 'Money put in (net)', data: props.points.map((p) => p.netInvested) },
])

const chartOptions = computed(() => ({
  chart: { type: 'line', background: 'transparent', toolbar: { show: false }, zoom: { enabled: false } },
  stroke: { width: [3, 2], curve: 'straight', dashArray: [0, 5] },
  xaxis: {
    categories: props.points.map((p) => formatDayKey(p.dayKey, { year: props.points.length > 6 })),
    labels: { style: { colors: 'var(--muted-foreground)' }, hideOverlappingLabels: true },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: { labels: { style: { colors: 'var(--muted-foreground)' }, formatter: (v) => Math.round(v).toLocaleString('en-US') } },
  grid: { borderColor: 'var(--border)' },
  colors: ['var(--primary)', 'var(--muted-foreground)'],
  legend: { position: 'top', labels: { colors: 'var(--muted-foreground)' } },
  dataLabels: { enabled: false },
  markers: { size: 3 },
  tooltip: { theme: settings.theme, y: { formatter: (v) => settings.currencySymbol + ' ' + Math.round(v).toLocaleString('en-US') } },
}))
</script>

<template>
  <div class="flex min-h-60 items-center justify-center">
    <apexchart v-if="points.length > 1" type="line" height="260" :options="chartOptions" :series="series" />
    <div v-else class="text-sm text-muted-foreground">Add a few updates to see the chart</div>
  </div>
</template>
