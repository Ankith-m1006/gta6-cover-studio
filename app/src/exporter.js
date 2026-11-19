// Export: renders the cover at a post size on an offscreen canvas with the same renderCover the preview uses, encodes
// it as a PNG on this machine and hands it to the browser as a download. Nothing is uploaded anywhere.

import { renderCover } from './render.js';

/** The post sizes the app exports. */
export const SIZES = {
  wide: { w: 1920, h: 1080, label: '1920 × 1080', note: 'Widescreen' },
  square: { w: 1080, h: 1080, label: '1080 × 1080', note: 'Square post' },
  portrait: { w: 1080, h: 1350, label: '1080 × 1350', note: 'Portrait post' },
};

/** Renders the cover at full export size and returns the canvas. */
export function renderCoverAtSize(state, sizeId) {
  const size = SIZES[sizeId] ?? SIZES.wide;
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  renderCover(canvas, state);
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be encoded'))), 'image/png');
  });
}

/** A file name from the caption and size, such as sunset-hustle-1920x1080.png. */
export function coverFileName(state, sizeId) {
  const size = SIZES[sizeId] ?? SIZES.wide;
  const slug = (state.caption || 'cover')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cover';
  return `${slug}-${size.w}x${size.h}.png`;
}

/** Exports the cover as a PNG download at one size; resolves to the file name. */
export async function downloadCoverPNG(state, sizeId) {
  const blob = await canvasToPngBlob(renderCoverAtSize(state, sizeId));
  const name = coverFileName(state, sizeId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/** The exported PNG as a data: URL (the same bytes the download writes), for the screenshot scenes. */
export async function exportCoverDataURL(state, sizeId) {
  const blob = await canvasToPngBlob(renderCoverAtSize(state, sizeId));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
