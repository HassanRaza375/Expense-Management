<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Bike, Car, AlertTriangle } from '@lucide/vue'
import { useVehicles } from '../composables/useVehicles.js'
import { useVehicleMaintenance } from '../composables/useVehicleMaintenance.js'
import { useFuelLogs } from '../composables/useFuelLogs.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import VehicleFormModal from '../components/VehicleFormModal.vue'

const router = useRouter()
const { vehicles, addVehicle, updateVehicle, deleteVehicle } = useVehicles()
const { logs, logsForVehicle, dueSoon } = useVehicleMaintenance()
const { fuelLogs, logsForVehicle: fuelLogsForVehicle } = useFuelLogs()

const modalOpen = ref(false)
const editingVehicle = ref(null)
const error = ref('')
const deleteError = ref('')

function openAdd() {
  editingVehicle.value = null
  error.value = ''
  modalOpen.value = true
}

function openEdit(vehicle) {
  editingVehicle.value = vehicle
  error.value = ''
  modalOpen.value = true
}

function handleSave(payload) {
  error.value = ''
  try {
    if (editingVehicle.value) {
      updateVehicle(editingVehicle.value.id, payload)
    } else {
      addVehicle(payload)
    }
    modalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDelete(vehicle) {
  deleteError.value = ''
  try {
    deleteVehicle(vehicle.id, [...logs, ...fuelLogs])
  } catch (e) {
    deleteError.value = `${vehicle.name}: ${e.message}`
  }
}

function entryCount(vehicleId) {
  return logsForVehicle(vehicleId).length + fuelLogsForVehicle(vehicleId).length
}

function isDueSoon(vehicleId) {
  return dueSoon().some((l) => l.vehicleId === vehicleId)
}

const sortedVehicles = computed(() => [...vehicles].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-xl">Vehicles</h2>
        <p class="mt-1 text-sm text-muted-foreground">Odometer, oil changes, parts, and service history for every bike and car.</p>
      </div>
      <Button @click="openAdd"><Plus class="h-4 w-4" /> Add vehicle</Button>
    </div>

    <p v-if="deleteError" class="m-0 text-sm text-destructive">{{ deleteError }}</p>

    <Card v-if="!sortedVehicles.length">
      <CardContent class="p-8 text-center text-muted-foreground">
        No vehicles yet. Add a bike or car to start logging maintenance.
      </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="vehicle in sortedVehicles"
        :key="vehicle.id"
        class="cursor-pointer transition-colors hover:border-primary"
        @click="router.push('/vehicles/' + vehicle.id)"
      >
        <CardContent class="flex flex-col gap-2 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Bike v-if="vehicle.type === 'bike'" class="h-4 w-4 text-muted-foreground" />
              <Car v-else class="h-4 w-4 text-muted-foreground" />
              <strong>{{ vehicle.name }}</strong>
            </div>
            <Badge v-if="isDueSoon(vehicle.id)" variant="warn" class="flex items-center gap-1">
              <AlertTriangle class="h-3 w-3" /> Due soon
            </Badge>
          </div>
          <div class="text-sm text-muted-foreground">
            {{ [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || '—' }}
          </div>
          <div class="amount text-lg font-semibold">{{ vehicle.currentOdometer.toLocaleString() }} km</div>
          <div class="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span v-if="vehicle.registrationNumber">Reg: {{ vehicle.registrationNumber }}</span>
            <span>{{ entryCount(vehicle.id) }} log entries</span>
            <span v-if="vehicle.purchaseDate">Owned since {{ formatDate(vehicle.purchaseDate, 'short') }}</span>
          </div>
          <div class="mt-1 flex gap-2" @click.stop>
            <Button variant="outline" size="sm" @click="openEdit(vehicle)">Edit</Button>
            <Button variant="destructive" size="sm" @click="handleDelete(vehicle)">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <VehicleFormModal :open="modalOpen" :vehicle="editingVehicle" @close="modalOpen = false" @save="handleSave" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
