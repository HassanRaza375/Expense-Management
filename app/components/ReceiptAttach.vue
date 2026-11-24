<script setup>
import { ref } from 'vue'
import { Paperclip, X, Eye } from '@lucide/vue'
import { useExpenses } from '../composables/useExpenses.js'
import { getAttachmentURL } from '../utils/attachments.js'
import { receiptViewUrl } from '../lib/sync/receiptsApi'
import { validateReceiptFile, formatBytes, RECEIPT_ACCEPT, MAX_RECEIPTS_PER_EXPENSE } from '../utils/receipts.js'
import { Button } from '@/components/ui/button/index.js'
import { Label } from '@/components/ui/label/index.js'
import { toast } from '@/components/ui/sonner/index.js'

// Receipts for ONE expense: photos or PDFs, up to a few. Two modes:
//  * expenseId given  (editing): files are saved immediately, like bill attachments;
//  * no expenseId     (adding):  files are only held here (v-model = File[]) and saved by the page right after the expense is.
const props = defineProps({
  expenseId: { type: String, default: '' },
  receipts: { type: Array, default: () => [] }, // saved receipts of that expense
  modelValue: { type: Array, default: () => [] }, // staged files (adding)
})
const emit = defineEmits(['update:modelValue'])

const { addReceipt, removeReceipt } = useExpenses()
const busy = ref(false)
const error = ref('')

const saved = () => (props.expenseId ? props.receipts : [])
const count = () => (props.expenseId ? props.receipts.length : props.modelValue.length)

async function onPick(e) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  error.value = ''
  busy.value = true
  try {
    for (const file of files) {
      const problem = validateReceiptFile(file, count())
      if (problem) {
        error.value = problem
        break
      }
      if (props.expenseId) {
        try {
          await addReceipt(props.expenseId, file)
        } catch (err) {
          error.value = err?.message || 'Could not save the receipt'
          break
        }
      } else {
        emit('update:modelValue', [...props.modelValue, file])
      }
    }
  } finally {
    busy.value = false
  }
}

async function viewSaved(r) {
  const url = await getAttachmentURL(r.id)
  if (url) {
    window.open(url, '_blank')
    return
  }
  if (r.remote) {
    // not on this device, but safely in the account: open the tab now (a popup blocker only allows it straight after the click), then send it to a short-lived signed address
    const tab = window.open('', '_blank')
    try {
      const signed = await receiptViewUrl(r.id)
      if (tab) tab.location.href = signed
      else window.location.assign(signed)
    } catch (e) {
      tab?.close()
      error.value = e?.status === 0 ? 'You are offline, and this receipt is kept in your account.' : 'This receipt could not be opened right now.'
    }
    return
  }
  error.value = 'That file is no longer stored on this device'
}

function viewStaged(file) {
  window.open(URL.createObjectURL(file), '_blank')
}

async function removeSaved(r) {
  await removeReceipt(props.expenseId, r.id)
  toast('Receipt removed')
}

function removeStaged(index) {
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="receipts">
    <Label>Receipts (optional)</Label>

    <div v-for="r in saved()" :key="r.id" class="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm" data-testid="receipt-item">
      <div class="min-w-0 flex-1 truncate">{{ r.filename }} <span class="text-muted-foreground">({{ formatBytes(r.size) }})</span></div>
      <Button type="button" variant="ghost" size="icon" title="View" aria-label="View receipt" data-testid="receipt-view" @click="viewSaved(r)"><Eye class="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="icon" title="Remove" aria-label="Remove receipt" data-testid="receipt-remove" @click="removeSaved(r)"><X class="h-4 w-4" /></Button>
    </div>

    <div v-for="(f, i) in expenseId ? [] : modelValue" :key="f.name + i" class="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm" data-testid="receipt-staged">
      <div class="min-w-0 flex-1 truncate">{{ f.name }} <span class="text-muted-foreground">({{ formatBytes(f.size) }})</span></div>
      <Button type="button" variant="ghost" size="icon" title="View" aria-label="View receipt" @click="viewStaged(f)"><Eye class="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="icon" title="Remove" aria-label="Remove receipt" data-testid="receipt-unstage" @click="removeStaged(i)"><X class="h-4 w-4" /></Button>
    </div>

    <div>
      <Button v-if="count() < MAX_RECEIPTS_PER_EXPENSE" type="button" variant="outline" size="sm" as="label" class="cursor-pointer" :disabled="busy">
        <Paperclip class="h-4 w-4" /> {{ busy ? 'Saving…' : count() ? 'Add another' : 'Attach a photo or PDF' }}
        <input type="file" :accept="RECEIPT_ACCEPT" multiple hidden data-testid="receipt-input" @change="onPick" />
      </Button>
    </div>
    <p v-if="error" class="m-0 text-sm text-destructive" role="alert" data-testid="receipt-error">{{ error }}</p>
  </div>
</template>
