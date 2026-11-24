<script setup>
import { reactive, watch, ref } from 'vue'
import { useConnections, BILL_TYPES } from '../composables/useBills.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  connection: { type: Object, default: null },
})

const emit = defineEmits(['close', 'save'])

const { addConnection, updateConnection } = useConnections()

const form = reactive({
  connectionName: '',
  provider: '',
  billType: 'electricity',
  consumerNumber: '',
  referenceNumber: '',
  accountNumber: '',
  meterNumber: '',
})

const error = ref('')

watch(
  () => [props.open, props.connection],
  () => {
    if (!props.open) return
    error.value = ''
    if (props.connection) {
      Object.assign(form, props.connection)
    } else {
      form.connectionName = ''
      form.provider = ''
      form.billType = 'electricity'
      form.consumerNumber = ''
      form.referenceNumber = ''
      form.accountNumber = ''
      form.meterNumber = ''
    }
  },
  { immediate: true }
)

function submit() {
  error.value = ''
  try {
    if (props.connection) {
      updateConnection(props.connection.id, { ...form })
    } else {
      addConnection({ ...form })
    }
    emit('save')
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ connection ? 'Edit connection' : 'Add connection' }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Connection name</Label>
          <Input v-model="form.connectionName" type="text" placeholder="Home electricity, Office gas..." />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Bill type</Label>
          <Select v-model="form.billType">
            <SelectTrigger><SelectValue>{{ BILL_TYPES.find((t) => t.value === form.billType)?.label }}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in BILL_TYPES" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Provider</Label>
          <Input v-model="form.provider" type="text" placeholder="LESCO, SNGPL, PTCL..." />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Consumer number</Label>
            <Input v-model="form.consumerNumber" type="text" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Reference number</Label>
            <Input v-model="form.referenceNumber" type="text" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Account number</Label>
            <Input v-model="form.accountNumber" type="text" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Meter number</Label>
            <Input v-model="form.meterNumber" type="text" />
          </div>
        </div>
      </div>
      <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button @click="submit">Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
