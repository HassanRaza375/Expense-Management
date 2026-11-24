<script setup>
import { Toaster } from 'vue-sonner'
import { useSettings } from '@/composables/useSettings.js'
import 'vue-sonner/style.css'

const { settings } = useSettings()
</script>

<template>
  <Toaster
    :theme="settings.theme"
    :toast-options="{
      classes: {
        toast: 'bg-card! text-card-foreground! border-border! font-sans! rounded-lg! shadow-lg!',
        actionButton: 'bg-primary! text-primary-foreground!',
        cancelButton: 'bg-secondary! text-secondary-foreground!',
      },
    }"
  />
</template>
