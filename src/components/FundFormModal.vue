<script setup>
import { reactive, watch } from 'vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Textarea } from '@/components/ui/textarea/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  fund: { type: Object, default: null }, // null = create mode
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  name: '',
  provider: '',
  notes: '',
})

function resetForm() {
  form.name = ''
  form.provider = ''
  form.notes = ''
}

watch(
  () => [props.open, props.fund],
  () => {
    if (!props.open) return
    if (props.fund) {
      form.name = props.fund.name
      form.provider = props.fund.provider || ''
      form.notes = props.fund.notes || ''
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
    error.message = 'Fund name is required'
    return
  }
  emit('save', { name: form.name, provider: form.provider, notes: form.notes })
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ fund ? 'Edit fund' : 'Add fund' }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Fund name</Label>
          <Input v-model="form.name" type="text" placeholder="e.g. Meezan Islamic Fund" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Provider (optional)</Label>
          <Input v-model="form.provider" type="text" placeholder="e.g. Al Meezan Investments" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Textarea v-model="form.notes" rows="2" />
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
