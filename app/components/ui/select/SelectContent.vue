<script setup>
import { SelectContent, SelectPortal, SelectViewport } from 'reka-ui'
import { cn } from '@/lib/utils.js'

defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <SelectPortal>
    <SelectContent
      :class="
        cn(
          'relative z-50 max-h-64 min-w-32 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          $props.class
        )
      "
      position="popper"
      :side-offset="4"
    >
      <SelectViewport class="p-1">
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>
