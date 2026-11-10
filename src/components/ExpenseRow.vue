<script setup>
import { Pencil, Copy, Trash2, Paperclip } from '@lucide/vue'
import { Button } from '@/components/ui/button/index.js'
import { Checkbox } from '@/components/ui/checkbox/index.js'
import { Badge } from '@/components/ui/badge/index.js'

// One transaction row. Presentation only: the page owns all data and logic.
// A refund is shown with a minus sign, the green colour AND a "Refund" label (never colour alone).
defineProps({
  expense: { type: Object, required: true },
  categoryName: { type: String, required: true },
  categoryIcon: { type: String, default: '' },
  amountText: { type: String, required: true }, // already formatted, without sign
  dateText: { type: String, default: '' }, // shown only when rows are not grouped by day
  accountName: { type: String, default: '' }, // '' = no account (nothing shown)
  selected: { type: Boolean, default: false },
})

defineEmits(['toggle', 'edit', 'duplicate', 'delete'])
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-3 last:border-b-0 sm:px-4" data-testid="row">
    <Checkbox :model-value="selected" :aria-label="`Select ${expense.note || categoryName}`" @update:model-value="$emit('toggle')" />
    <span class="text-lg" aria-hidden="true">{{ categoryIcon }}</span>
    <div class="min-w-0 flex-1 basis-28">
      <div class="truncate font-medium">{{ expense.note || categoryName }}</div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span v-if="dateText">{{ dateText }} ·</span>
        <span class="truncate">{{ categoryName }}</span>
        <Badge v-if="accountName" variant="outline" class="max-w-32 truncate" data-testid="row-account">{{ accountName }}</Badge>
        <button v-if="expense.receipts?.length" type="button" class="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50" :aria-label="expense.receipts.length === 1 ? '1 receipt, open to view' : expense.receipts.length + ' receipts, open to view'" data-testid="row-receipt" @click="$emit('edit')">
          <Paperclip class="h-3 w-3" aria-hidden="true" />{{ expense.receipts.length }}
        </button>
        <Badge v-if="expense.kind === 'refund'" variant="good">Refund</Badge>
        <Badge v-if="expense.source === 'recurring'" variant="secondary">recurring</Badge>
        <Badge v-if="expense.source === 'bill'" variant="secondary">bill</Badge>
      </div>
    </div>
    <div class="ml-auto flex items-center gap-1">
      <div class="amount mr-1 whitespace-nowrap font-semibold" :class="expense.kind === 'refund' ? 'text-status-good' : ''" data-testid="row-amount">
        <template v-if="expense.kind === 'refund'"><span aria-hidden="true">−</span><span class="sr-only">Refund, reduces spending: </span></template>{{ amountText }}
      </div>
      <Button variant="ghost" size="icon" title="Edit" aria-label="Edit" @click="$emit('edit')"><Pencil class="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" title="Duplicate" aria-label="Duplicate" @click="$emit('duplicate')"><Copy class="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" title="Delete" aria-label="Delete" data-testid="delete-row" @click="$emit('delete')"><Trash2 class="h-4 w-4" /></Button>
    </div>
  </div>
</template>
