<script setup>
import { computed } from 'vue'
import { accountPickerChoices } from '../utils/accountsView.js'
import { useAccounts } from '../composables/useAccounts.js'
import { Button } from '@/components/ui/button/index.js'
import { Label } from '@/components/ui/label/index.js'

// "Which account?" chips for the expense and income forms. Hidden entirely until the first account exists, so the
// fast-entry form is exactly what it was before accounts. Choosing "No account" keeps the record Unassigned.
const props = defineProps({
  modelValue: { type: String, default: '' },
  refocusId: { type: String, default: '' }, // after a click, hand focus back to this input (so Enter still saves)
  label: { type: String, default: 'Account' },
  noneLabel: { type: String, default: 'No account' },
})
const emit = defineEmits(['update:modelValue'])

const { store } = useAccounts()
const choices = computed(() => accountPickerChoices(store, props.modelValue))

function pick(id) {
  emit('update:modelValue', id)
  if (props.refocusId) document.getElementById(props.refocusId)?.focus()
}
</script>

<template>
  <div v-if="choices.length" class="flex flex-col gap-1.5" data-testid="account-picker">
    <Label id="account-picker-label">{{ label }}</Label>
    <div class="flex flex-wrap gap-2" role="group" aria-labelledby="account-picker-label">
      <Button type="button" size="sm" :variant="!modelValue ? 'default' : 'outline'" :aria-pressed="!modelValue" data-testid="account-none" @click="pick('')">{{ noneLabel }}</Button>
      <Button
        v-for="a in choices"
        :key="a.id"
        type="button"
        size="sm"
        :variant="modelValue === a.id ? 'default' : 'outline'"
        :aria-pressed="modelValue === a.id"
        :data-testid="`account-${a.id}`"
        @click="pick(a.id)"
      >
        {{ a.name }}<span v-if="a.archived" class="ml-1 text-xs opacity-70">(archived)</span>
      </Button>
    </div>
  </div>
</template>
