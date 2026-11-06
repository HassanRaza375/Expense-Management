<script setup>
import { computed } from 'vue'
import { formatDate } from '../utils/date.js'
import { formatDayKey, isDayKey } from '../utils/reporting.js'
import { useSettings } from '@/composables/useSettings.js'

const props = defineProps({
  points: {
    // [{ date, total }]
    type: Array,
    required: true,
  },
})

const { settings } = useSettings()

const series = computed(() => [{ name: 'Spent', data: props.points.map((p) => p.total) }])

const chartOptions = computed(() => ({
  chart: { type: 'bar', background: 'transparent', toolbar: { show: false } },
  xaxis: {
    // day keys ('YYYY-MM-DD') are formatted without a time zone so a label can never land on the wrong day
    categories: props.points.map((p) => (isDayKey(p.date) ? formatDayKey(p.date, { year: false }) : formatDate(p.date, 'short'))),
    labels: { style: { colors: 'var(--muted-foreground)' } },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: { labels: { style: { colors: 'var(--muted-foreground)' } } },
  grid: { borderColor: 'var(--border)' },
  colors: ['var(--primary)'],
  dataLabels: { enabled: false },
  plotOptions: { bar: { borderRadius: 4, columnWidth: '55%' } },
  tooltip: { theme: settings.theme },
}))
</script>

<template>
  <div class="flex min-h-60 items-center justify-center">
    <apexchart v-if="points.length" type="bar" height="240" :options="chartOptions" :series="series" />
    <div v-else class="text-sm text-muted-foreground">No spending yet this cycle</div>
  </div>
</template>
