<script setup>
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { useSync, finishChoice, dismissChoice } from '../composables/useSync'

// The first time an account is used on this device. Two ways to go, never an automatic merge of two ledgers: that is the one way to count money twice.
const sync = useSync()
</script>

<template>
  <Dialog :open="!!sync.choice" @update:open="(v) => !v && !sync.choice?.busy && dismissChoice()">
    <DialogContent class="max-w-md">
      <div v-if="sync.choice" class="flex flex-col gap-4" data-testid="first-sign-in">
        <DialogHeader>
          <DialogTitle>Set up sync</DialogTitle>
          <DialogDescription>
            You are signed in as {{ sync.choice.email }}. This device has {{ sync.choice.deviceRecords }} saved record{{ sync.choice.deviceRecords === 1 ? '' : 's' }}; your account has {{ sync.choice.accountRecords }}.
            Choose what to do. Nothing is merged automatically.
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5 rounded-md border border-border p-3">
            <span class="text-sm font-medium">Upload this device's data to my account</span>
            <span class="text-xs text-muted-foreground">
              Copies what is on this device into your account. A safety copy is saved first and you can undo the upload afterwards.
              <template v-if="sync.choice.accountRecords > 0">Your account already has records: any that are the same on both, this device's version wins, and the rest are added together (so something entered in both places will appear twice).</template>
            </span>
            <div><Button size="sm" :disabled="sync.choice.busy" data-testid="choice-upload" @click="finishChoice('upload')">{{ sync.choice.busy ? 'Working...' : 'Upload this device\'s data' }}</Button></div>
          </div>
          <div class="flex flex-col gap-1.5 rounded-md border border-border p-3">
            <span class="text-sm font-medium">Start with my account's data</span>
            <span class="text-xs text-muted-foreground">Uses what your account already has. The data on this device is left exactly as it is and comes back when you sign out.</span>
            <div><Button size="sm" variant="outline" :disabled="sync.choice.busy" data-testid="choice-account" @click="finishChoice('account')">Start with my account's data</Button></div>
          </div>
          <p v-if="sync.choice.error" class="m-0 text-sm text-destructive" role="alert" data-testid="choice-error">{{ sync.choice.error }}</p>
          <div><Button variant="ghost" size="sm" :disabled="sync.choice.busy" data-testid="choice-later" @click="dismissChoice">Not now</Button></div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
