<script setup>
import { ref } from 'vue'
import { formatCurrency } from '../utils/currency.js'
import { useSettings } from '../composables/useSettings.js'
import { useCategories } from '../composables/useCategories.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'

const props = defineProps({
  template: { type: Object, required: true },
})

const emit = defineEmits(['add', 'skip', 'snooze'])

const { settings } = useSettings()
const { findById } = useCategories()

const variableAmount = ref('')
const asking = ref(false)

const category = findById(props.template.categoryId)

function onAddClick() {
  if (props.template.amountMode === 'variable') {
    asking.value = true
    return
  }
  emit('add', props.template.amount)
}

function confirmVariable() {
  const amt = Number(variableAmount.value)
  if (!(amt > 0)) return
  emit('add', amt)
  asking.value = false
  variableAmount.value = ''
}
</script>

<template>
  <Card class="border-l-4 border-l-status-warn">
    <CardContent class="flex flex-col gap-3 p-4">
      <div>
        <div class="font-medium">{{ category?.icon }} {{ template.name }}</div>
        <div class="text-sm text-muted-foreground">
          {{ template.amountMode === 'fixed' ? formatCurrency(template.amount, settings.currencySymbol) : 'Variable amount' }}
          · due day {{ template.dueDay }}
        </div>
      </div>

      <div v-if="!asking" class="flex flex-wrap gap-2">
        <Button size="sm" @click="onAddClick">Add</Button>
        <Button size="sm" variant="outline" @click="emit('skip')">Skip this cycle</Button>
        <Button size="sm" variant="ghost" @click="emit('snooze')">Snooze</Button>
      </div>

      <div v-else class="flex flex-wrap items-center gap-2">
        <Input v-model="variableAmount" type="number" min="0" step="0.01" :placeholder="`How much was ${template.name}?`" class="flex-1 min-w-36" />
        <Button size="sm" @click="confirmVariable">Confirm</Button>
        <Button size="sm" variant="ghost" @click="asking = false">Cancel</Button>
      </div>
    </CardContent>
  </Card>
</template>
