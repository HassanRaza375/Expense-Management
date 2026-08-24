<script setup>
import { reactive, watch } from 'vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  tag: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({ name: '', icon: '🔧', color: '#4A9498' })

function resetForm() {
  form.name = ''
  form.icon = '🔧'
  form.color = '#4A9498'
}

watch(
  () => [props.open, props.tag],
  () => {
    if (!props.open) return
    if (props.tag) {
      form.name = props.tag.name
      form.icon = props.tag.icon
      form.color = props.tag.color
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

const error = reactive({ message: '' })

function submit() {
  error.message = ''
  if (!form.name.trim()) {
    error.message = 'Tag name is required'
    return
  }
  emit('save', { name: form.name, icon: form.icon, color: form.color })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ tag ? 'Edit tag' : 'Add tag' }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input v-model="form.name" type="text" placeholder="e.g. Tire change" />
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
      <p v-if="error.message" class="m-0 text-sm text-destructive">{{ error.message }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
