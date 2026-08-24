<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Bike, Car, Plus, Gauge, Fuel } from '@lucide/vue'
import { useVehicles } from '../composables/useVehicles.js'
import { useVehicleMaintenance } from '../composables/useVehicleMaintenance.js'
import { useVehicleTags } from '../composables/useVehicleTags.js'
import { useFuelLogs } from '../composables/useFuelLogs.js'
import { useSettings } from '../composables/useSettings.js'
import { useBudget } from '../composables/useBudget.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import StatCard from '../components/StatCard.vue'
import TrendChart from '../components/TrendChart.vue'
import VehicleFormModal from '../components/VehicleFormModal.vue'
import MaintenanceLogFormModal from '../components/MaintenanceLogFormModal.vue'
import FuelLogFormModal from '../components/FuelLogFormModal.vue'

const route = useRoute()
const router = useRouter()
const { settings } = useSettings()
const { findById, updateVehicle } = useVehicles()
const { logsForVehicle, addLog, updateLog, deleteLog, undoDelete, totalCostForVehicle, groupedByMonth, dueSoon } = useVehicleMaintenance()
const { findById: findTag } = useVehicleTags()
const {
  logsForVehicle: fuelLogsForVehicle,
  addFuelLog,
  updateFuelLog,
  deleteFuelLog,
  undoDelete: undoFuelDelete,
  totalCostForVehicle: totalFuelCostForVehicle,
  groupedByMonth: fuelGroupedByMonth,
  mileageStats,
} = useFuelLogs()
const budget = useBudget()

const vehicle = computed(() => findById(route.params.id))

const logs = computed(() => logsForVehicle(route.params.id))
const monthGroups = computed(() => groupedByMonth(logs.value))

const fuelLogs = computed(() => fuelLogsForVehicle(route.params.id))
const fuelMonthGroups = computed(() => fuelGroupedByMonth(fuelLogs.value))
const mileage = computed(() => mileageStats(route.params.id))
const lastFillUp = computed(() => fuelLogs.value[0] || null)

function inCycle(date) {
  return budget.cycle.value && new Date(date) >= budget.cycle.value.start && new Date(date) <= budget.cycle.value.end
}

const cycleCost = computed(
  () =>
    logs.value.filter((l) => inCycle(l.date)).reduce((sum, l) => sum + (l.cost || 0), 0) +
    fuelLogs.value.filter((l) => inCycle(l.date)).reduce((sum, l) => sum + (l.cost || 0), 0)
)

const totalCost = computed(() => totalCostForVehicle(route.params.id) + totalFuelCostForVehicle(route.params.id))

const lastServiceLog = computed(() => logs.value.find((l) => l.tagId) || null)

const nextDue = computed(() => dueSoon().find((l) => l.vehicleId === route.params.id) || null)

const odometerTrendPoints = computed(() => {
  const points = [
    ...logs.value.filter((l) => l.odometer != null).map((l) => ({ date: l.date, odometer: l.odometer })),
    ...fuelLogs.value.map((l) => ({ date: l.date, odometer: l.odometer })),
  ]
  return points
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((p) => ({ date: p.date, total: p.odometer }))
})

function tagFor(log) {
  return log.tagId ? findTag(log.tagId) : null
}

const vehicleModalOpen = ref(false)
const logModalOpen = ref(false)
const fuelModalOpen = ref(false)
const editingLog = ref(null)
const editingFuelLog = ref(null)
const error = ref('')

function openEditVehicle() {
  error.value = ''
  vehicleModalOpen.value = true
}

function saveVehicle(payload) {
  error.value = ''
  try {
    updateVehicle(vehicle.value.id, payload)
    vehicleModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function openAddLog() {
  editingLog.value = null
  error.value = ''
  logModalOpen.value = true
}

function openEditLog(log) {
  editingLog.value = log
  error.value = ''
  logModalOpen.value = true
}

function saveLog(payload) {
  error.value = ''
  try {
    if (editingLog.value) {
      updateLog(editingLog.value.id, payload)
    } else {
      addLog({ ...payload, vehicleId: vehicle.value.id })
    }
    logModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDeleteLog(id) {
  deleteLog(id)
  toast('Log entry deleted', {
    action: { label: 'Undo', onClick: () => undoDelete() },
  })
}

function openAddFuelLog() {
  editingFuelLog.value = null
  error.value = ''
  fuelModalOpen.value = true
}

function openEditFuelLog(log) {
  editingFuelLog.value = log
  error.value = ''
  fuelModalOpen.value = true
}

function saveFuelLog(payload) {
  error.value = ''
  try {
    if (editingFuelLog.value) {
      updateFuelLog(editingFuelLog.value.id, payload)
    } else {
      addFuelLog({ ...payload, vehicleId: vehicle.value.id })
    }
    fuelModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDeleteFuelLog(id) {
  deleteFuelLog(id)
  toast('Fuel entry deleted', {
    action: { label: 'Undo', onClick: () => undoFuelDelete() },
  })
}
</script>

<template>
  <div v-if="!vehicle" class="flex flex-col items-center gap-3 p-14 text-center">
    <p class="text-muted-foreground">Vehicle not found.</p>
    <Button @click="router.push('/vehicles')">Back to Vehicles</Button>
  </div>

  <div v-else class="flex flex-col gap-4">
    <Button variant="ghost" size="sm" class="w-fit" @click="router.push('/vehicles')"><ArrowLeft class="h-4 w-4" /> Back to Vehicles</Button>

    <Card>
      <CardContent class="flex flex-wrap items-center justify-between gap-4 p-4">
        <div class="flex items-center gap-3">
          <Bike v-if="vehicle.type === 'bike'" class="h-6 w-6 text-primary" />
          <Car v-else class="h-6 w-6 text-primary" />
          <div>
            <h2 class="font-display text-xl">{{ vehicle.name }}</h2>
            <p class="m-0 text-sm text-muted-foreground">
              {{ [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || vehicle.type }}
              <span v-if="vehicle.registrationNumber"> · {{ vehicle.registrationNumber }}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" @click="openEditVehicle">Edit vehicle</Button>
      </CardContent>
    </Card>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard :icon="Gauge" label="Current odometer" :value="vehicle.currentOdometer.toLocaleString() + ' km'" />
      <StatCard label="Spent this cycle" :value="formatCurrency(cycleCost, settings.currencySymbol)" sub="Maintenance + fuel" />
      <StatCard label="Total spent" :value="formatCurrency(totalCost, settings.currencySymbol)" sub="Maintenance + fuel" />
      <StatCard
        label="Last service"
        :value="lastServiceLog ? formatDate(lastServiceLog.date, 'short') : '—'"
        :sub="nextDue ? 'Due soon' : ''"
        :status="nextDue ? 'warn' : ''"
      />
    </section>

    <Card v-if="odometerTrendPoints.length > 1">
      <CardContent class="p-4">
        <h3 class="mb-3 text-sm font-semibold">Odometer over time</h3>
        <TrendChart :points="odometerTrendPoints" />
      </CardContent>
    </Card>

    <Tabs default-value="maintenance">
      <TabsList>
        <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        <TabsTrigger value="fuel">Fuel</TabsTrigger>
      </TabsList>

      <TabsContent value="maintenance" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Maintenance log</h3>
          <Button size="sm" @click="openAddLog"><Plus class="h-4 w-4" /> Add log entry</Button>
        </div>

        <Card v-if="!logs.length">
          <CardContent class="p-8 text-center text-muted-foreground"> No log entries yet. Log an odometer reading, oil change, part, or service visit. </CardContent>
        </Card>

        <div v-for="group in monthGroups" :key="group.month" class="flex flex-col gap-2">
          <div class="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{{ group.month }}</span>
            <span v-if="group.total > 0">{{ formatCurrency(group.total, settings.currencySymbol) }}</span>
          </div>
          <Card v-for="log in group.items" :key="log.id">
            <CardContent class="flex flex-wrap items-center justify-between gap-3 p-3">
              <div class="flex items-center gap-3">
                <span v-if="tagFor(log)" class="text-base leading-none">{{ tagFor(log).icon }}</span>
                <Gauge v-else class="h-4 w-4 text-muted-foreground" />
                <div>
                  <div class="flex items-center gap-2">
                    <strong>{{ tagFor(log) ? tagFor(log).name : 'Odometer reading' }}</strong>
                    <Badge v-if="log.title" variant="secondary">{{ log.title }}</Badge>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ formatDate(log.date, 'short') }}
                    <span v-if="log.odometer != null"> · {{ log.odometer.toLocaleString() }} km</span>
                    <span v-if="log.vendor"> · {{ log.vendor }}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span v-if="log.cost > 0" class="amount font-semibold">{{ formatCurrency(log.cost, settings.currencySymbol) }}</span>
                <Button variant="outline" size="sm" @click="openEditLog(log)">Edit</Button>
                <Button variant="destructive" size="sm" @click="handleDeleteLog(log.id)">Delete</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="fuel" class="flex flex-col gap-4">
        <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard :icon="Fuel" label="Avg mileage" :value="mileage.average ? mileage.average.toFixed(1) + ' km/l' : '—'" />
          <StatCard label="Total fuel spend" :value="formatCurrency(totalFuelCostForVehicle(vehicle.id), settings.currencySymbol)" />
          <StatCard
            label="Last fill-up"
            :value="lastFillUp ? formatDate(lastFillUp.date, 'short') : '—'"
            :sub="lastFillUp ? lastFillUp.liters + ' L' : ''"
          />
        </section>

        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Fuel log</h3>
          <Button size="sm" @click="openAddFuelLog"><Plus class="h-4 w-4" /> Add fuel entry</Button>
        </div>

        <Card v-if="!fuelLogs.length">
          <CardContent class="p-8 text-center text-muted-foreground"> No fuel entries yet. Log a fill-up to start tracking mileage. </CardContent>
        </Card>

        <div v-for="group in fuelMonthGroups" :key="group.month" class="flex flex-col gap-2">
          <div class="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{{ group.month }}</span>
            <span v-if="group.total > 0">{{ formatCurrency(group.total, settings.currencySymbol) }}</span>
          </div>
          <Card v-for="log in group.items" :key="log.id">
            <CardContent class="flex flex-wrap items-center justify-between gap-3 p-3">
              <div class="flex items-center gap-3">
                <Fuel class="h-4 w-4 text-muted-foreground" />
                <div>
                  <div class="flex items-center gap-2">
                    <strong>{{ log.liters }} L</strong>
                    <Badge v-if="!log.fullTank" variant="secondary">Partial fill</Badge>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ formatDate(log.date, 'short') }} · {{ log.odometer.toLocaleString() }} km
                    <span v-if="log.stationName"> · {{ log.stationName }}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span v-if="log.cost > 0" class="amount font-semibold">{{ formatCurrency(log.cost, settings.currencySymbol) }}</span>
                <Button variant="outline" size="sm" @click="openEditFuelLog(log)">Edit</Button>
                <Button variant="destructive" size="sm" @click="handleDeleteFuelLog(log.id)">Delete</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>

    <VehicleFormModal :open="vehicleModalOpen" :vehicle="vehicle" @close="vehicleModalOpen = false" @save="saveVehicle" />
    <MaintenanceLogFormModal :open="logModalOpen" :log="editingLog" @close="logModalOpen = false" @save="saveLog" />
    <FuelLogFormModal :open="fuelModalOpen" :log="editingFuelLog" @close="fuelModalOpen = false" @save="saveFuelLog" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
