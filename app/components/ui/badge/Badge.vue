<script setup>
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils.js'

const props = defineProps({
  variant: { type: String, default: 'default' },
  class: { type: String, default: '' },
})

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-border text-foreground',
        warn: 'border-transparent bg-status-warn/15 text-status-warn',
        good: 'border-transparent bg-status-good/15 text-status-good',
        over: 'border-transparent bg-status-over/15 text-status-over',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)
</script>

<template>
  <span :class="cn(badgeVariants({ variant }), props.class)"><slot /></span>
</template>
