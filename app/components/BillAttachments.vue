<script setup>
import { ref } from 'vue'
import { Paperclip, X, Eye } from '@lucide/vue'
import { useBills, ATTACHMENT_KINDS } from '../composables/useBills.js'
import { getAttachmentURL } from '../utils/attachments.js'
import { Button } from '@/components/ui/button/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const props = defineProps({
  bill: { type: Object, required: true },
})

const { addAttachment, removeAttachment } = useBills()
const busyKind = ref('')

function attachmentFor(kind) {
  return props.bill.attachments.find((a) => a.kind === kind)
}

async function handleFile(e, kind) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  busyKind.value = kind
  try {
    const existing = attachmentFor(kind)
    if (existing) await removeAttachment(props.bill, existing.id)
    await addAttachment(props.bill, file, kind)
  } catch {
    toast.error('Could not save attachment')
  } finally {
    busyKind.value = ''
  }
}

async function view(attachmentId) {
  const url = await getAttachmentURL(attachmentId)
  if (url) window.open(url, '_blank')
}

async function remove(kind) {
  const existing = attachmentFor(kind)
  if (existing) await removeAttachment(props.bill, existing.id)
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
    <div v-for="kind in ATTACHMENT_KINDS" :key="kind.value" class="flex items-center justify-between gap-2 rounded-md border border-border p-2">
      <div class="min-w-0 flex-1">
        <div class="text-xs text-muted-foreground">{{ kind.label }}</div>
        <div v-if="attachmentFor(kind.value)" class="truncate text-sm">
          {{ attachmentFor(kind.value).filename }}
          <span class="text-muted-foreground">({{ formatSize(attachmentFor(kind.value).size) }})</span>
        </div>
        <div v-else class="text-sm text-muted-foreground">Not attached</div>
      </div>
      <div class="flex shrink-0 gap-1">
        <template v-if="attachmentFor(kind.value)">
          <Button variant="ghost" size="icon" title="View" @click="view(attachmentFor(kind.value).id)"><Eye class="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title="Remove" @click="remove(kind.value)"><X class="h-4 w-4" /></Button>
        </template>
        <template v-else>
          <Button variant="outline" size="icon" as="label" class="cursor-pointer" :disabled="busyKind === kind.value">
            <Paperclip class="h-4 w-4" />
            <input type="file" accept="image/*,application/pdf" hidden @change="handleFile($event, kind.value)" />
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>
