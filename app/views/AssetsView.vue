<script setup>
import { reactive, ref, computed } from 'vue'
import { Plus } from '@lucide/vue'
import { useAssets, ASSET_CATEGORIES } from '../composables/useAssets.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'

const { assets, addAsset, updateAsset, deleteAsset, totalValue } = useAssets()
const { settings } = useSettings()

const filterCategory = ref('all')
const sortBy = ref('recent') // recent | warranty

const modalOpen = ref(false)
const editingId = ref(null)
const error = ref('')

const form = reactive({
  name: '',
  category: 'other',
  purchaseDate: '',
  purchasePrice: '',
  currentValue: '',
  warrantyExpiry: '',
  serialNumber: '',
  notes: '',
})

function resetForm() {
  form.name = ''
  form.category = 'other'
  form.purchaseDate = ''
  form.purchasePrice = ''
  form.currentValue = ''
  form.warrantyExpiry = ''
  form.serialNumber = ''
  form.notes = ''
}

function openAdd() {
  editingId.value = null
  resetForm()
  error.value = ''
  modalOpen.value = true
}

function openEdit(asset) {
  editingId.value = asset.id
  Object.assign(form, asset)
  modalOpen.value = true
}

function submit() {
  error.value = ''
  try {
    if (editingId.value) {
      updateAsset(editingId.value, { ...form })
    } else {
      addAsset({ ...form })
    }
    modalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

const filtered = computed(() => {
  let list = assets
  if (filterCategory.value !== 'all') list = list.filter((a) => a.category === filterCategory.value)
  list = [...list]
  if (sortBy.value === 'warranty') {
    list.sort((a, b) => {
      if (!a.warrantyExpiry) return 1
      if (!b.warrantyExpiry) return -1
      return new Date(a.warrantyExpiry) - new Date(b.warrantyExpiry)
    })
  } else {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }
  return list
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-xl">Assets</h2>
        <p class="mt-1 text-sm text-muted-foreground">Total owned value: {{ formatCurrency(totalValue(), settings.currencySymbol) }}</p>
      </div>
      <Button @click="openAdd"><Plus class="h-4 w-4" /> Add asset</Button>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row">
      <Select v-model="filterCategory">
        <SelectTrigger class="w-full sm:w-44" aria-label="Category"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          <SelectItem v-for="c in ASSET_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="sortBy">
        <SelectTrigger class="w-full sm:w-52" aria-label="Sort"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">Recently added</SelectItem>
          <SelectItem value="warranty">Warranty expiring soon</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Card v-if="!filtered.length">
      <CardContent class="p-8 text-center text-muted-foreground">
        No assets yet. Add the things you own to track their value over time.
      </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card v-for="asset in filtered" :key="asset.id">
        <CardContent class="flex flex-col gap-2 p-4">
          <div class="flex items-center justify-between">
            <strong>{{ asset.name }}</strong>
            <Badge variant="secondary">{{ asset.category }}</Badge>
          </div>
          <div class="amount text-xl font-semibold">{{ formatCurrency(asset.currentValue, settings.currencySymbol) }}</div>
          <div class="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span v-if="asset.purchaseDate">Bought {{ formatDate(asset.purchaseDate, 'short') }}</span>
            <span v-if="asset.warrantyExpiry">Warranty until {{ formatDate(asset.warrantyExpiry, 'short') }}</span>
            <span v-if="asset.serialNumber">S/N {{ asset.serialNumber }}</span>
          </div>
          <div class="mt-1 flex gap-2">
            <Button variant="outline" size="sm" @click="openEdit(asset)">Edit</Button>
            <Button variant="destructive" size="sm" @click="deleteAsset(asset.id)">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog :open="modalOpen" @update:open="(v) => !v && (modalOpen = false)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? 'Edit asset' : 'Add asset' }}</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5"><Label>Name</Label><Input v-model="form.name" type="text" /></div>
          <div class="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select v-model="form.category">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in ASSET_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5"><Label>Purchase date</Label><Input v-model="form.purchaseDate" type="date" /></div>
          <div class="flex flex-col gap-1.5"><Label>Purchase price</Label><Input v-model="form.purchasePrice" type="number" min="0" /></div>
          <div class="flex flex-col gap-1.5"><Label>Current value</Label><Input v-model="form.currentValue" type="number" min="0" /></div>
          <div class="flex flex-col gap-1.5"><Label>Warranty expiry</Label><Input v-model="form.warrantyExpiry" type="date" /></div>
          <div class="flex flex-col gap-1.5"><Label>Serial number</Label><Input v-model="form.serialNumber" type="text" /></div>
          <div class="flex flex-col gap-1.5"><Label>Notes</Label><Textarea v-model="form.notes" rows="2" /></div>
        </div>
        <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button variant="ghost" @click="modalOpen = false">Cancel</Button>
          <Button @click="submit">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
