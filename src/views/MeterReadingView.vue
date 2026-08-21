<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Plus, Pencil, Trash2, Gauge, Zap, Flame, Droplet } from '@lucide/vue'
import { useConnections, BILL_TYPES } from '../composables/useBills.js'
import { useMeterReadings } from '../composables/useMeterReadings.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import StatCard from '../components/StatCard.vue'
import TrendChart from '../components/TrendChart.vue'
import MeterReadingFormModal from '../components/MeterReadingFormModal.vue'

const route = useRoute()
const router = useRouter()
const { findConnection } = useConnections()
const { readingsForConnection, history, unitsSinceLast, averagePerReading, addReading, updateReading, deleteReading, undoDelete } = useMeterReadings()

const TYPE_ICONS = { electricity: Zap, gas: Flame, water: Droplet }

const connection = computed(() => findConnection(route.params.connectionId))
const connectionLabel = computed(() => BILL_TYPES.find((t) => t.value === connection.value?.billType)?.label || '')

const sortedReadings = computed(() => readingsForConnection(route.params.connectionId))
const historyList = computed(() => history(route.params.connectionId))
const latest = computed(() => sortedReadings.value[0] || null)
const trendPoints = computed(() =>
  historyList.value.filter((h) => h.unitsUsed != null).map((h) => ({ date: h.date, total: h.unitsUsed }))
)

const modalOpen = ref(false)
const editingReading = ref(null)
const error = ref('')

function openAdd() {
  editingReading.value = null
  error.value = ''
  modalOpen.value = true
}

function openEdit(reading) {
  editingReading.value = reading
  error.value = ''
  modalOpen.value = true
}

function handleSave(payload) {
  error.value = ''
  try {
    if (editingReading.value) {
      updateReading(editingReading.value.id, payload)
    } else {
      addReading({ ...payload, connectionId: route.params.connectionId, source: 'manual' })
    }
    modalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDelete(reading) {
  try {
    deleteReading(reading.id)
    toast('Reading deleted', {
      action: { label: 'Undo', onClick: () => undoDelete() },
    })
  } catch (e) {
    toast.error(e.message)
  }
}

function deltaFor(reading) {
  const entry = historyList.value.find((h) => h.id === reading.id)
  return entry ? entry.unitsUsed : null
}
</script>

<template>
  <div v-if="!connection" class="flex flex-col items-center gap-3 p-14 text-center">
    <p class="text-muted-foreground">Meter not found.</p>
    <Button @click="router.push('/bills')">Back to Bills</Button>
  </div>

  <div v-else class="flex flex-col gap-4">
    <Button variant="ghost" size="sm" class="w-fit" @click="router.push('/bills')"><ArrowLeft class="h-4 w-4" /> Back to Bills</Button>

    <Card>
      <CardContent class="flex flex-wrap items-center justify-between gap-4 p-4">
        <div class="flex items-center gap-3">
          <component :is="TYPE_ICONS[connection.billType] || Gauge" class="h-6 w-6 text-primary" />
          <div>
            <h2 class="font-display text-xl">{{ connection.connectionName }}</h2>
            <p class="m-0 text-sm text-muted-foreground">
              {{ connectionLabel }}
              <span v-if="connection.meterNumber"> · Meter #{{ connection.meterNumber }}</span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard
        :icon="Gauge"
        label="Latest reading"
        :value="latest ? latest.reading.toLocaleString() : '—'"
        :sub="latest ? formatDate(latest.date, 'short') : ''"
      />
      <StatCard
        label="Since last reading"
        :value="unitsSinceLast(route.params.connectionId) != null ? unitsSinceLast(route.params.connectionId).toLocaleString() : '—'"
      />
      <StatCard label="Average per reading" :value="averagePerReading(route.params.connectionId) ? averagePerReading(route.params.connectionId).toFixed(1) : '—'" />
    </section>

    <Card v-if="trendPoints.length > 1">
      <CardContent class="p-4">
        <h3 class="mb-3 text-sm font-semibold">Units used between readings</h3>
        <TrendChart :points="trendPoints" />
      </CardContent>
    </Card>

    <div class="flex items-center justify-between">
      <h3 class="text-base font-semibold">Readings</h3>
      <Button size="sm" @click="openAdd"><Plus class="h-4 w-4" /> Add reading</Button>
    </div>

    <Card v-if="!sortedReadings.length">
      <CardContent class="p-8 text-center text-muted-foreground"> No readings yet. Add your first meter reading to start tracking usage. </CardContent>
    </Card>

    <Card v-else class="overflow-hidden py-0">
      <div v-for="r in sortedReadings" :key="r.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <strong class="amount">{{ r.reading.toLocaleString() }}</strong>
            <Badge v-if="r.source === 'bill'" variant="secondary">from bill</Badge>
            <span v-if="deltaFor(r) != null" class="text-xs text-muted-foreground">
              ({{ deltaFor(r) >= 0 ? '+' : '' }}{{ deltaFor(r) }} vs previous)
            </span>
          </div>
          <div class="text-xs text-muted-foreground">
            {{ formatDate(r.date, 'short') }}
            <span v-if="r.notes"> · {{ r.notes }}</span>
          </div>
        </div>
        <div class="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            :title="r.source === 'bill' ? 'Edit the linked bill instead' : 'Edit'"
            :disabled="r.source === 'bill'"
            @click="openEdit(r)"
          ><Pencil class="h-4 w-4" /></Button>
          <Button
            variant="ghost"
            size="icon"
            :title="r.source === 'bill' ? 'Delete the linked bill instead' : 'Delete'"
            :disabled="r.source === 'bill'"
            @click="handleDelete(r)"
          ><Trash2 class="h-4 w-4" /></Button>
        </div>
      </div>
    </Card>

    <MeterReadingFormModal :open="modalOpen" :reading="editingReading" @close="modalOpen = false" @save="handleSave" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
