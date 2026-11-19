// Finds where the subject of a photo is, so the auto-arranged panels frame faces rather than sky or knees. A cheap
// heuristic on a 96 px thumbnail: skin-toned pixels (a YCbCr box) weighted by local detail (faces are busy, sunset
// skies and sand are smooth); the topmost dense band of them is taken as the face, and its centre is the subject point.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Returns {x, y} in 0..1 of the photo: the likely face or subject point. Falls back to the upper middle. */
export function findSubject(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = 96 / Math.max(iw, ih);
  const w = Math.max(8, Math.round(iw * scale));
  const h = Math.max(8, Math.round(ih * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;

  // Weight every skin-toned, detailed pixel; keep the weights per pixel so the face band can be found after.
  const weights = new Float32Array(w * h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
      if (cb < 80 || cb > 125 || cr < 137 || cr > 170 || r < 70 || r < b) continue;
      const detail = Math.abs(lum[i - 1] - lum[i + 1]) + Math.abs(lum[i - w] - lum[i + w]);
      weights[i] = Math.min(1, detail / 40);
      total += weights[i];
    }
  }
  if (total < 3) return { x: 0.5, y: 0.35 };
  // The face is the topmost dense patch of skin: start the band where the first 6% of the weight has gone by,
  // and take the weighted centre of a band about a fifth of the photo tall from there.
  let acc = 0;
  let top = 0;
  for (let y = 0; y < h && acc < total * 0.06; y++) {
    for (let x = 0; x < w; x++) acc += weights[y * w + x];
    top = y;
  }
  const bandEnd = Math.min(h, top + Math.round(h * 0.2));
  let sx = 0, sy = 0, sw = 0;
  for (let y = Math.max(0, top - 2); y < bandEnd; y++) {
    for (let x = 0; x < w; x++) {
      const v = weights[y * w + x];
      sx += x * v;
      sy += y * v;
      sw += v;
    }
  }
  if (sw < 1) return { x: 0.5, y: 0.35 };
  return { x: clamp(sx / sw / w, 0.15, 0.85), y: clamp(sy / sw / h, 0.12, 0.8) };
}

/**
 * The crop for a photo's n-th use in the grid, around its subject point: a wide hero first, then a face close-up,
 * a medium shot, details beside and below the subject, a wider off-centre scene and a very tight face.
 */
export function subjectCrop(subject, n) {
  const { x, y } = subject;
  const shots = [
    { zoom: 1, x, y },
    { zoom: 2.4, x, y: y + 0.02 },
    { zoom: 1.6, x, y: y + 0.12 },
    { zoom: 1.9, x: x - 0.2, y: y + 0.32 },
    { zoom: 1.3, x: x + 0.28, y: y + 0.05 },
    { zoom: 3.2, x: x + 0.02, y: y - 0.01 },
    { zoom: 2, x: x + 0.2, y: y + 0.4 },
  ];
  const s = shots[n % shots.length];
  return { zoom: s.zoom, x: clamp(s.x, 0, 1), y: clamp(s.y, 0, 1) };
}
