// Renders a whole cover onto a canvas at the canvas's own size: the panels with their cropped photos, the colour
// grade, the frame, the grade's light (sunset glow, neon tubes, tape), a vignette and the lettering. The live preview
// and every exported PNG are drawn by this one function, so what the editor shows is what the PNG holds.

import { buildPanels, captionPlacement, layoutById, tracePoly } from './layouts.js';
import { GRADES, applyGradePixels, seededRandom } from './grades.js';
import { TITLE_FONT, drawLettering } from './lettering.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Where a photo lands in a panel box for a crop {zoom, x, y} (x, y: the photo point kept at the box's centre). */
export function photoPlacement(img, box, crop) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(box.w / iw, box.h / ih) * crop.zoom;
  const dw = iw * s;
  const dh = ih * s;
  const dx = clamp(box.x + box.w / 2 - crop.x * dw, box.x + box.w - dw, box.x);
  const dy = clamp(box.y + box.h / 2 - crop.y * dh, box.y + box.h - dh, box.y);
  return { dx, dy, dw, dh };
}

/** Keeps a crop's centre point where the photo still covers the whole panel box. */
export function clampCrop(img, box, crop) {
  const { dw, dh } = photoPlacement(img, box, crop);
  const hx = box.w / 2 / dw;
  const hy = box.h / 2 / dh;
  crop.x = clamp(crop.x, hx, 1 - hx);
  crop.y = clamp(crop.y, hy, 1 - hy);
  return crop;
}

function drawPhotoPanel(ctx, panel, img, crop) {
  const { dx, dy, dw, dh } = photoPlacement(img, panel.box, crop);
  ctx.save();
  tracePoly(ctx, panel.poly);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** An empty panel: a dusk gradient with diagonal stripes and a plus, inviting a photo. */
function drawEmptyPanel(ctx, panel, index, unit) {
  const { x, y, w, h } = panel.box;
  ctx.save();
  tracePoly(ctx, panel.poly);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, index % 2 ? '#2a1b5c' : '#4a1d5e');
  g.addColorStop(1, index % 2 ? '#c2456f' : '#f08a4b');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = unit * 0.012;
  for (let k = -h; k < w; k += unit * 0.04) {
    ctx.beginPath();
    ctx.moveTo(x + k, y + h);
    ctx.lineTo(x + k + h, y);
    ctx.stroke();
  }
  const s = Math.min(w, h) * 0.18;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillRect(x + w / 2 - s / 2, y + h / 2 - s * 0.07, s, s * 0.14);
  ctx.fillRect(x + w / 2 - s * 0.07, y + h / 2 - s / 2, s * 0.14, s);
  ctx.restore();
}

/** The grade's light over the graded panels: a low sun and sky glow, neon tubes along the gutters, or a tape cast. */
function drawGradeLight(ctx, w, h, gradeId, panels, gutter, strength) {
  const big = Math.max(w, h);
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.35 + strength * 0.65);
  if (gradeId === 'sunset') {
    ctx.globalCompositeOperation = 'soft-light';
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, 'rgba(255, 150, 60, 0.8)');
    sky.addColorStop(0.55, 'rgba(255, 70, 120, 0.35)');
    sky.addColorStop(1, 'rgba(40, 0, 90, 0.55)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen';
    const sun = ctx.createRadialGradient(w * 0.82, h * 0.1, 0, w * 0.82, h * 0.1, big * 0.6);
    sun.addColorStop(0, 'rgba(255, 214, 140, 0.6)');
    sun.addColorStop(0.35, 'rgba(255, 110, 90, 0.22)');
    sun.addColorStop(1, 'rgba(255, 60, 120, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);
  } else if (gradeId === 'neon') {
    ctx.globalCompositeOperation = 'screen';
    const pink = ctx.createRadialGradient(w * 0.04, h * 0.98, 0, w * 0.04, h * 0.98, big * 0.75);
    pink.addColorStop(0, 'rgba(255, 40, 190, 0.45)');
    pink.addColorStop(1, 'rgba(255, 40, 190, 0)');
    ctx.fillStyle = pink;
    ctx.fillRect(0, 0, w, h);
    const cyan = ctx.createRadialGradient(w * 0.96, h * 0.02, 0, w * 0.96, h * 0.02, big * 0.7);
    cyan.addColorStop(0, 'rgba(30, 220, 255, 0.38)');
    cyan.addColorStop(1, 'rgba(30, 220, 255, 0)');
    ctx.fillStyle = cyan;
    ctx.fillRect(0, 0, w, h);
    if (panels.length > 1 || gutter > 0) drawNeonTubes(ctx, panels, gutter, Math.min(w, h));
  } else if (gradeId === 'vhs') {
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(90, 20, 70, 0.18)';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Neon tubes traced round each panel, alternating pink and cyan, each with a wide glow and a hot white core. */
function drawNeonTubes(ctx, panels, gutter, unit) {
  const width = Math.max(1.5, Math.max(gutter, unit * 0.008) * 0.26);
  ctx.globalCompositeOperation = 'lighter';
  panels.forEach((p, i) => {
    const color = i % 2 ? '#20e8ff' : '#ff2bd6';
    tracePoly(ctx, p.poly);
    ctx.shadowColor = color;
    ctx.shadowBlur = width * 7;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.shadowBlur = width * 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = width * 0.35;
    ctx.stroke();
  });
}

function drawVignette(ctx, w, h) {
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(8, 0, 20, 0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** VHS, under the lettering: a tracking glitch band slipped sideways across the panels, with tape noise in it. */
function drawTapeGlitch(ctx, w, h, seed) {
  const rand = seededRandom(seed * 31 + 5);
  const bandY = Math.round(h * 0.78);
  const bandH = Math.round(h * 0.022);
  const shift = Math.round(w * 0.012);
  const band = document.createElement('canvas');
  band.width = w;
  band.height = bandH;
  band.getContext('2d').drawImage(ctx.canvas, 0, bandY, w, bandH, 0, 0, w, bandH);
  ctx.drawImage(band, shift, bandY);
  ctx.drawImage(band, shift - w, bandY);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let i = 0; i < 26; i++) ctx.fillRect(rand() * w, bandY + rand() * bandH, rand() * w * 0.25, Math.max(1, h * 0.0015));
}

/** VHS, over everything: colour channels pulled apart, scanlines and the deck's on-screen display. */
function drawTapeEffects(ctx, w, h, seed, gutter) {
  const img = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(img.data);
  const d = img.data;
  const k = Math.max(1, Math.round(w * 0.0028));
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      d[i] = src[row + Math.min(w - 1, x + k) * 4];
      d[i + 2] = src[row + Math.max(0, x - k) * 4 + 2];
    }
  }
  ctx.putImageData(img, 0, 0);

  const step = Math.max(2, Math.round(h / 360));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, Math.max(1, step * 0.45));

  const unit = Math.min(w, h);
  const size = unit * 0.042;
  const pad = Math.max(gutter, unit * 0.02) + size * 0.6;
  ctx.save();
  ctx.font = `${size}px ${TITLE_FONT}`;
  ctx.letterSpacing = `${size * 0.12}px`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f6f6f6';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowOffsetX = size * 0.06;
  ctx.shadowOffsetY = size * 0.06;
  ctx.fillText('PLAY', pad, pad);
  const tw = ctx.measureText('PLAY').width;
  ctx.beginPath();
  ctx.moveTo(pad + tw + size * 0.35, pad + size * 0.12);
  ctx.lineTo(pad + tw + size * 1.05, pad + size * 0.56);
  ctx.lineTo(pad + tw + size * 0.35, pad + size * 1.0);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillText('SP 0:12:46', w - pad, pad);
  ctx.fillText('NOV. 19 1986', w - pad, pad + size * 1.35);
  ctx.restore();
}

/**
 * Draws the cover described by `state` onto `canvas` and returns its panels (for hit-testing in the editor).
 * state: { photos: [{img}], panels: [{photo, zoom, x, y}], layoutId, gradeId, gradeStrength, frame, gutter, caption,
 * tagline, footer, placement, captionScale, tilt, lettering, seed }.
 */
export function renderCover(canvas, state) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const unit = Math.min(w, h);
  const layout = layoutById(state.layoutId);
  const grade = GRADES[state.gradeId] ?? GRADES.sunset;
  const gutter = layout.id === 'solo' ? 0 : Math.max(2, Math.round(unit * state.gutter));
  const panels = buildPanels(layout, w, h, gutter);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  panels.forEach((panel, i) => {
    const crop = state.panels[i];
    const photo = crop ? state.photos[crop.photo] : null;
    if (photo) drawPhotoPanel(ctx, panel, photo.img, crop);
    else drawEmptyPanel(ctx, panel, i, unit);
  });

  const pixels = ctx.getImageData(0, 0, w, h);
  applyGradePixels(pixels, state.gradeId, state.gradeStrength, state.seed);
  ctx.putImageData(pixels, 0, 0);

  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = state.frame === 'white' ? '#f3eee6' : grade.frame;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  drawGradeLight(ctx, w, h, state.gradeId, panels, gutter, state.gradeStrength);
  drawVignette(ctx, w, h);
  if (state.gradeId === 'vhs') drawTapeGlitch(ctx, w, h, state.seed);
  drawLettering(ctx, w, h, {
    caption: state.caption,
    tagline: state.tagline,
    footer: state.footer,
    placement: state.placement === 'auto' ? captionPlacement(layout, w / h) : state.placement,
    scale: state.captionScale,
    tilt: state.tilt,
    style: state.lettering === 'auto' ? grade.lettering : state.lettering,
    frame: gutter,
  });
  if (state.gradeId === 'vhs') drawTapeEffects(ctx, w, h, state.seed, gutter);
  ctx.restore();
  return panels;
}
