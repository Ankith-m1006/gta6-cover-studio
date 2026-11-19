// Colour grades. Each grade is a tone curve, a saturation push and a gradient map (luminance to colour) mixed over
// the photo, applied per pixel to the panels; render.js then adds the grade's light (sky glow, neon, tape).

/** The grade presets, in the order the editor shows them. */
export const GRADES = {
  sunset: {
    name: 'Vice Sunset',
    note: 'magenta dusk, orange sky',
    stops: [[0, '#12052b'], [0.24, '#5a1466'], [0.48, '#d8366e'], [0.7, '#ff8a3d'], [0.88, '#ffc978'], [1, '#fff4d6']],
    mix: 0.55, contrast: 1.32, saturation: 1.3, lift: 0, grain: 12,
    frame: '#12061f', lettering: 'sunset',
  },
  neon: {
    name: 'Neon Night',
    note: 'violet shadows, pink and cyan light',
    stops: [[0, '#03020f'], [0.22, '#140a5c'], [0.45, '#5b1aa8'], [0.66, '#ff2f97'], [0.85, '#ff9bd8'], [1, '#d9fdff']],
    mix: 0.62, contrast: 1.38, saturation: 1.3, lift: 0, grain: 10,
    frame: '#05020f', lettering: 'neon',
  },
  vhs: {
    name: 'VHS Tape',
    note: 'faded tape, scanlines, colour bleed',
    stops: [[0, '#1c1230'], [0.45, '#8e4f7d'], [0.75, '#f0a98e'], [1, '#fff3da']],
    mix: 0.38, contrast: 1.08, saturation: 0.98, lift: 16, grain: 24,
    frame: '#0d0b12', lettering: 'chrome',
  },
};

export const GRADE_IDS = Object.keys(GRADES);

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const lutCache = new Map();

/** Builds (once) a grade's 256-entry gradient map and its tone curve. */
export function gradeTables(id) {
  if (lutCache.has(id)) return lutCache.get(id);
  const g = GRADES[id];
  const map = new Uint8ClampedArray(256 * 3);
  const stops = g.stops.map(([t, c]) => [t, hexToRgb(c)]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    const s = u * u * (3 - 2 * u);
    for (let c = 0; c < 3; c++) map[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * s;
  }
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // A gentle S around the midpoint, scaled by the grade's contrast, then the black lift.
    const sCurve = 0.5 + (t - 0.5) * g.contrast + Math.sin((t - 0.5) * Math.PI * 2) * 0.03 * (g.contrast - 1) * 4;
    curve[i] = g.lift + Math.min(1, Math.max(0, sCurve)) * (255 - g.lift);
  }
  const tables = { map, curve };
  lutCache.set(id, tables);
  return tables;
}

/** A small seeded PRNG, so a cover's grain is the same in the preview and every export of it. */
export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Grades an ImageData in place: tone curve, saturation, the gradient map mixed by `strength` x the grade's mix, and
 * film grain. Transparent pixels (the gutters, before the frame is laid behind them) are left alone.
 */
export function applyGradePixels(image, id, strength = 1, seed = 7) {
  const g = GRADES[id];
  const { map, curve } = gradeTables(id);
  const d = image.data;
  const mix = Math.min(1, g.mix * strength);
  const sat = 1 + (g.saturation - 1) * strength;
  const grainAmp = g.grain * Math.min(1, strength + 0.3);
  const rand = seededRandom(seed);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i], gr = d[i + 1], b = d[i + 2];
    const l = (r * 77 + gr * 150 + b * 29) >> 8;
    const lc = curve[l];
    const ratio = (lc + 1) / (l + 1);
    r = l + (r - l) * sat; gr = l + (gr - l) * sat; b = l + (b - l) * sat;
    r *= ratio; gr *= ratio; b *= ratio;
    const m = Math.min(255, Math.max(0, lc | 0)) * 3;
    const n = (rand() - 0.5) * grainAmp;
    d[i] = r + (map[m] - r) * mix + n;
    d[i + 1] = gr + (map[m + 1] - gr) * mix + n;
    d[i + 2] = b + (map[m + 2] - b) * mix + n;
  }
  return image;
}

/** A CSS gradient of the grade's map, for its swatch in the editor. */
export function gradeSwatchCss(id) {
  const stops = GRADES[id].stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ');
  return `linear-gradient(90deg, ${stops})`;
}
