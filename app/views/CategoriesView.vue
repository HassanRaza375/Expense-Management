<script setup>
import { reactive, ref } from 'vue'
import { Plus, ArrowUp, ArrowDown } from '@lucide/vue'
import { useCategories } from '../composables/useCategories.js'
import { useExpenses } from '../composables/useExpenses.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog/index.js'

const { sorted, addCategory, updateCategory, reorder, canDelete, deleteCategory } = useCategories()
const { expenses, reassignCategory } = useExpenses()

const modalOpen = ref(false)
const editingId = ref(null)
const error = ref('')

const form = reactive({ name: '', icon: '🏷️', color: '#4A9498' })

const reassignModalOpen = ref(false)
const reassignFromId = ref(null)
const reassignToId = ref('')

function resetForm() {
  form.name = ''
  form.icon = '🏷️'
  form.color = '#4A9498'
}

function openAdd() {
  editingId.value = null
  resetForm()
  error.value = ''
  modalOpen.value = true
}

function openEdit(cat) {
  editingId.value = cat.id
  form.name = cat.name
  form.icon = cat.icon
  form.color = cat.color
  error.value = ''
  modalOpen.value = true
}

function submit() {
  error.value = ''
  try {
    if (editingId.value) {
      updateCategory(editingId.value, { name: form.name, icon: form.icon, color: form.color })
    } else {
      addCategory({ name: form.name, icon: form.icon, color: form.color })
    }
    modalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function attemptDelete(cat) {
  if (canDelete(cat.id, expenses)) {
    deleteCategory(cat.id, expenses)
  } else {
    reassignFromId.value = cat.id
    reassignToId.value = sorted().find((c) => c.id !== cat.id)?.id || ''
    reassignModalOpen.value = true
  }
}

function confirmReassign() {
  reassignCategory(reassignFromId.value, reassignToId.value)
  deleteCategory(reassignFromId.value, expenses)
  reassignModalOpen.value = false
}

function moveUp(idx) {
  if (idx === 0) return
  const list = sorted()
  const ids = list.map((c) => c.id)
  ;[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
  reorder(ids)
}

function moveDown(idx) {
  const list = sorted()
  if (idx === list.length - 1) return
  const ids = list.map((c) => c.id)
  ;[ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]]
  reorder(ids)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-display text-xl">Categories</h2>
      <Button @click="openAdd"><Plus class="h-4 w-4" /> Add category</Button>
    </div>

    <div class="flex flex-col gap-2">
      <Card v-for="(cat, idx) in sorted()" :key="cat.id">
        <CardContent class="flex flex-wrap items-center gap-3 p-3">
          <span class="text-lg" :style="{ color: cat.color }">{{ cat.icon }}</span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ cat.name }}</span>
          <Badge v-if="cat.isDefault" variant="secondary">default</Badge>
          <div class="ml-auto flex flex-wrap items-center gap-2 sm:ml-0">
            <div class="flex gap-0.5">
              <Button variant="outline" size="icon" class="h-7 w-7" @click="moveUp(idx)"><ArrowUp class="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="icon" class="h-7 w-7" @click="moveDown(idx)"><ArrowDown class="h-3.5 w-3.5" /></Button>
            </div>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" @click="openEdit(cat)">Edit</Button>
              <Button variant="destructive" size="sm" :disabled="cat.isDefault" @click="attemptDelete(cat)">Delete</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog :open="modalOpen" @update:open="(v) => !v && (modalOpen = false)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>{{ editingId ? 'Edit category' : 'Add category' }}</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input v-model="form.name" type="text" placeholder="e.g. Groceries" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Icon (emoji)</Label>
            <Input v-model="form.icon" type="text" maxlength="4" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Color</Label>
            <Input v-model="form.color" type="color" class="h-9 p-1" />
          </div>
        </div>
        <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button variant="ghost" @click="modalOpen = false">Cancel</Button>
          <Button @click="submit">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="reassignModalOpen" @update:open="(v) => !v && (reassignModalOpen = false)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reassign expenses first</DialogTitle>
          <DialogDescription>This category has expenses. Choose where to move them before deleting.</DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-1.5">
          <Label>Move expenses to</Label>
          <Select v-model="reassignToId">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cat in sorted().filter((c) => c.id !== reassignFromId)" :key="cat.id" :value="cat.id">
                {{ cat.icon }} {{ cat.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" @click="reassignModalOpen = false">Cancel</Button>
          <Button @click="confirmReassign">Reassign & delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
