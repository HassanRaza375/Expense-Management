// Square-crop maths for the profile photo. Pure, so tests check it without a browser. Coordinates: the "view" is the square the user looks through (`view` px wide);
// the image is drawn at `scale = baseScale * zoom` with its top-left corner at (x, y) relative to the view's top-left. The image must always cover the view.

export interface CropInput {
  imgW: number;
  imgH: number;
  view: number;
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** The scale at which the image just covers the view. */
export const baseScale = (imgW: number, imgH: number, view: number): number => Math.max(view / imgW, view / imgH);

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : MIN_ZOOM));

/** Keeps the image covering the view: its left/top edge may not pass the view's, its right/bottom edge may not fall short of it. */
export function clampOffset({ imgW, imgH, view, zoom, x, y }: CropInput): { x: number; y: number } {
  const s = baseScale(imgW, imgH, view) * clampZoom(zoom);
  const minX = view - imgW * s;
  const minY = view - imgH * s;
  return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
}

/** The offset that centres the image in the view at this zoom. */
export function centred(imgW: number, imgH: number, view: number, zoom: number): { x: number; y: number } {
  const s = baseScale(imgW, imgH, view) * clampZoom(zoom);
  return clampOffset({ imgW, imgH, view, zoom, x: (view - imgW * s) / 2, y: (view - imgH * s) / 2 });
}

/** Zooms about the view's centre: the point in the middle of the view stays in the middle. */
export function zoomAboutCentre(input: CropInput, nextZoom: number): { x: number; y: number; zoom: number } {
  const z = clampZoom(nextZoom);
  const base = baseScale(input.imgW, input.imgH, input.view);
  const s0 = base * clampZoom(input.zoom);
  const s1 = base * z;
  const cx = (input.view / 2 - input.x) / s0; // the source pixel under the centre
  const cy = (input.view / 2 - input.y) / s0;
  const o = clampOffset({ ...input, zoom: z, x: input.view / 2 - cx * s1, y: input.view / 2 - cy * s1 });
  return { ...o, zoom: z };
}

/** The part of the source image the view shows, in source pixels (for drawImage). */
export function sourceRect({ imgW, imgH, view, zoom, x, y }: CropInput): { sx: number; sy: number; sw: number; sh: number } {
  const o = clampOffset({ imgW, imgH, view, zoom, x, y });
  const s = baseScale(imgW, imgH, view) * clampZoom(zoom);
  const side = view / s;
  return { sx: Math.min(imgW - side, Math.max(0, -o.x / s)), sy: Math.min(imgH - side, Math.max(0, -o.y / s)), sw: side, sh: side };
}
