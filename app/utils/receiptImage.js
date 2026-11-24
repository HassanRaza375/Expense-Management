// Browser-only helper: shrink a large photo before it is stored (a phone photo is often 5-10 MB; a readable receipt needs
// about 1600 px). Never throws and never makes things worse: on any problem, or if the result is not smaller, the
// ORIGINAL file is returned unchanged. PDFs and small images are returned as they are. Outside a browser it does nothing.
const MAX_SIDE = 1600
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024

export async function shrinkReceiptImage(file) {
  try {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file
    if (!file || !String(file.type).startsWith('image/') || file.size <= SHRINK_ABOVE_BYTES) return file
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff' // JPEG has no transparency: a transparent PNG would turn black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    const name = String(file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}
