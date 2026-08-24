<script setup>
import { ref } from 'vue'
import { Plus, Pencil, Trash2 } from '@lucide/vue'
import { useVehicleTags } from '../composables/useVehicleTags.js'
import { useVehicleMaintenance } from '../composables/useVehicleMaintenance.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import TagFormModal from './TagFormModal.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const { tags, addTag, updateTag, deleteTag } = useVehicleTags()
const { logs } = useVehicleMaintenance()

const formOpen = ref(false)
const editingTag = ref(null)
const error = ref('')

function openAdd() {
  editingTag.value = null
  error.value = ''
  formOpen.value = true
}

function openEdit(tag) {
  editingTag.value = tag
  error.value = ''
  formOpen.value = true
}

function handleSave(payload) {
  error.value = ''
  try {
    if (editingTag.value) {
      updateTag(editingTag.value.id, payload)
    } else {
      addTag(payload)
    }
    formOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDelete(tag) {
  error.value = ''
  try {
    deleteTag(tag.id, logs)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>Manage tags</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-2">
        <Card v-for="tag in tags" :key="tag.id">
          <CardContent class="flex items-center gap-3 p-3">
            <span class="text-lg">{{ tag.icon }}</span>
            <span class="min-w-0 flex-1 truncate font-medium">{{ tag.name }}</span>
            <Button variant="outline" size="icon" class="h-7 w-7" @click="openEdit(tag)"><Pencil class="h-3.5 w-3.5" /></Button>
            <Button variant="outline" size="icon" class="h-7 w-7" @click="handleDelete(tag)"><Trash2 class="h-3.5 w-3.5" /></Button>
          </CardContent>
        </Card>
        <p v-if="!tags.length" class="m-0 text-sm text-muted-foreground">No tags yet.</p>
      </div>

      <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>

      <Button variant="outline" class="w-full" @click="openAdd"><Plus class="h-4 w-4" /> Add tag</Button>
    </DialogContent>

    <TagFormModal :open="formOpen" :tag="editingTag" @close="formOpen = false" @save="handleSave" />
  </Dialog>
</template>
