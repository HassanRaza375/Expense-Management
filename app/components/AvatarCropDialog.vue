<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Label } from '@/components/ui/label/index.js'
import { centred, clampOffset, clampZoom, baseScale, sourceRect, zoomAboutCentre, MAX_ZOOM, MIN_ZOOM } from '../lib/account/crop'

// Pick a photo, drag it and zoom until the square shows what you want, then save: the browser sends only the square (512 x 512 JPEG), never the original file.
const props = defineProps({
  open: { type: Boolean, default: false },
  file: { type: Object, default: null }, // a File chosen by the user
})
const emit = defineEmits(['close', 'save'])

const VIEW = 256 // CSS px of the square the user looks through
const OUT = 512 // px of the picture that is sent
const MAX_BYTES = 400 * 1024

const img = ref(null) // HTMLImageElement
const url = ref('')
const natural = ref({ w: 0, h: 0 })
const zoom = ref(1)
const pos = ref({ x: 0, y: 0 })
const error = ref('')
const saving = ref(false)

function release() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  img.value = null
}

watch(
  () => [props.open, props.file],
  () => {
    release()
    error.value = ''
    if (!props.open || !props.file) return
    const objectUrl = URL.createObjectURL(props.file)
    const el = new Image()
    el.onload = () => {
      natural.value = { w: el.naturalWidth, h: el.naturalHeight }
      zoom.value = 1
      pos.value = centred(el.naturalWidth, el.naturalHeight, VIEW, 1)
      img.value = el
    }
    el.onerror = () => {
      error.value = 'That file could not be opened as a picture.'
    }
    el.src = objectUrl
    url.value = objectUrl
  },
  { immediate: true }
)
onBeforeUnmount(release)

const input = () => ({ imgW: natural.value.w, imgH: natural.value.h, view: VIEW, zoom: zoom.value, x: pos.value.x, y: pos.value.y })
const scale = computed(() => (img.value ? baseScale(natural.value.w, natural.value.h, VIEW) * clampZoom(zoom.value) : 1))
const imgStyle = computed(() => ({
  width: natural.value.w * scale.value + 'px',
  height: natural.value.h * scale.value + 'px',
  transform: `translate(${pos.value.x}px, ${pos.value.y}px)`,
}))

function setZoom(z) {
  if (!img.value) return
  const r = zoomAboutCentre(input(), Number(z))
  zoom.value = r.zoom
  pos.value = { x: r.x, y: r.y }
}

// dragging with a pointer, and the arrow keys for people who do not use one
let drag = null
function down(e) {
  if (!img.value) return
  drag = { px: e.clientX, py: e.clientY, x: pos.value.x, y: pos.value.y }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function move(e) {
  if (!drag) return
  pos.value = clampOffset({ ...input(), x: drag.x + e.clientX - drag.px, y: drag.y + e.clientY - drag.py })
}
function up() {
  drag = null
}
function key(e) {
  const step = e.shiftKey ? 24 : 8
  const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
  if (!d || !img.value) return
  e.preventDefault()
  pos.value = clampOffset({ ...input(), x: pos.value.x + d[0], y: pos.value.y + d[1] })
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

async function save() {
  if (!img.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const { sx, sy, sw, sh } = sourceRect(input())
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff' // a transparent PNG becomes white, not black, as a JPEG
    ctx.fillRect(0, 0, OUT, OUT)
    ctx.drawImage(img.value, sx, sy, sw, sh, 0, 0, OUT, OUT)
    let blob = null
    for (const q of [0.88, 0.78, 0.66, 0.5]) {
      blob = await toBlob(canvas, q)
      if (blob && blob.size <= MAX_BYTES) break
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error('size')
    emit('save', blob)
  } catch {
    error.value = 'The photo could not be prepared. Try a different picture.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>Profile photo</DialogTitle>
        <DialogDescription>Drag the picture to place it and use the slider to zoom. It is saved as a square and shown round.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col items-center gap-3">
        <div
          class="relative touch-none overflow-hidden rounded-full border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :style="{ width: VIEW + 'px', height: VIEW + 'px', maxWidth: '100%' }"
          tabindex="0"
          role="img"
          aria-label="Photo preview. Use the arrow keys to move the picture."
          data-testid="crop-view"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @keydown="key"
        >
          <img v-if="img" :src="url" alt="" draggable="false" class="pointer-events-none absolute left-0 top-0 max-w-none select-none" :style="imgStyle" />
        </div>
        <div class="flex w-full flex-col gap-1.5">
          <Label for="crop-zoom">Zoom</Label>
          <input id="crop-zoom" type="range" :min="MIN_ZOOM" :max="MAX_ZOOM" step="0.01" :value="zoom" class="w-full" :disabled="!img" @input="setZoom($event.target.value)" />
        </div>
        <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('close')">Cancel</Button>
        <Button :disabled="!img || saving" data-testid="crop-save" @click="save">{{ saving ? 'Saving...' : 'Save photo' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
