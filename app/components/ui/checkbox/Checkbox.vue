<script setup>
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui'
import { Check } from '@lucide/vue'
import { cn } from '@/lib/utils.js'

defineProps({ class: { type: String, default: '' } })
const checked = defineModel({ type: Boolean, default: false })
</script>

<template>
  <CheckboxRoot
    v-model="checked"
    :class="
      cn(
        'peer h-4 w-4 shrink-0 rounded-sm border border-input shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground',
        $props.class
      )
    "
  >
    <CheckboxIndicator class="flex items-center justify-center text-current">
      <Check class="h-3.5 w-3.5" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
