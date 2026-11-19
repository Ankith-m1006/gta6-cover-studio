// The cover's lettering: the caption as a stacked title in Anton (each line scaled to the same width, so the words
// lock together like a poster logo), extruded and double-outlined, a script tagline in Pacifico with a neon glow over
// it, and a small spaced-out footer line. Both fonts are SIL OFL files under app/fonts/.

export const TITLE_FONT = 'Anton';
export const SCRIPT_FONT = 'Pacifico';

/** Lettering styles: fill gradient stops, outline ink, inner outline, extrusion and glow. */
export const LETTERING = {
  sunset: {
    name: 'Sunset gradient',
    fill: [[0, '#fff6b8'], [0.38, '#ffb347'], [0.7, '#ff4f7f'], [1, '#d31d8a']],
    ink: '#1a0628', inner: '#fff8ec', extrude: '#4c0b45', glow: 'rgba(255, 90, 140, 0.55)',
    script: '#ffe9a8', scriptGlow: '#ff3c8e',
  },
  neon: {
    name: 'Neon tube',
    fill: [[0, '#ffffff'], [0.6, '#ffe4fb'], [1, '#ffb8ef']],
    ink: '#0a0420', inner: '#ff2bd6', extrude: '#1b0a46', glow: 'rgba(255, 43, 214, 0.9)',
    script: '#c9fbff', scriptGlow: '#18e7ff',
  },
  chrome: {
    name: 'Chrome',
    fill: [[0, '#ffffff'], [0.42, '#bfd0ff'], [0.5, '#3a2c6c'], [0.62, '#9a6fc4'], [0.85, '#ffc2e6'], [1, '#ffffff']],
    ink: '#0b0716', inner: '#ffffff', extrude: '#24163f', glow: 'rgba(160, 120, 255, 0.5)',
    script: '#ff9ed8', scriptGlow: '#ff4fb0',
  },
  white: {
    name: 'Bold white',
    fill: [[0, '#ffffff'], [1, '#f1ece4']],
    ink: '#000000', inner: '#000000', extrude: '#000000', glow: 'rgba(0, 0, 0, 0.6)',
    script: '#ffffff', scriptGlow: '#ff5a8a',
  },
};

/** Splits the caption into title lines: the user's own line breaks, else a balanced split of a long caption. */
export function captionLines(text, aspect) {
  const t = text.trim().toUpperCase();
  if (!t) return [];
  if (t.includes('\n')) return t.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const words = t.split(/\s+/);
  const oneLineMax = aspect > 1.4 ? 15 : 10;
  if (words.length < 2 || t.length <= oneLineMax) return [t];
  let best = [t];
  let bestLen = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const m = Math.max(a.length, b.length);
    if (m < bestLen) {
      bestLen = m;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Lays out the title lines: every line is scaled to one shared width, short words capped so they do not tower.
 * Returns the line boxes relative to the block's centre, and the block's size.
 */
function layoutTitle(ctx, lines, maxW, baseSize) {
  ctx.font = `${baseSize}px ${TITLE_FONT}`;
  ctx.letterSpacing = `${baseSize * 0.01}px`;
  const natural = lines.map((l) => ctx.measureText(l).width);
  const target = Math.min(maxW, Math.max(...natural));
  const gap = baseSize * 0.07;
  const out = [];
  let y = 0;
  lines.forEach((line, i) => {
    const size = Math.min(baseSize * 1.45, (baseSize * target) / natural[i]);
    ctx.font = `${size}px ${TITLE_FONT}`;
    ctx.letterSpacing = `${size * 0.01}px`;
    const m = ctx.measureText(line);
    const ascent = m.actualBoundingBoxAscent || size * 0.82;
    const descent = m.actualBoundingBoxDescent || 0;
    y += ascent;
    out.push({ line, size, y, width: m.width, ascent, descent });
    y += descent + gap;
  });
  const height = y - gap;
  out.forEach((o) => (o.y -= height / 2));
  return { lines: out, width: target, height };
}

function fillGradient(ctx, style, top, bottom) {
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  style.fill.forEach(([t, c]) => grad.addColorStop(t, c));
  return grad;
}

/**
 * Draws the caption, tagline and footer onto a w x h cover. `opts`: caption, tagline, footer, placement
 * ('top' | 'center' | 'bottom'), scale (title size multiplier), tilt (degrees), style (a LETTERING key), frame
 * (the gutter width, to keep the footer inside the frame).
 */
export function drawLettering(ctx, w, h, opts) {
  const style = LETTERING[opts.style] ?? LETTERING.sunset;
  const aspect = w / h;
  const lines = captionLines(opts.caption ?? '', aspect);
  const unit = Math.min(w, h);
  const footerSize = unit * 0.03;
  const footerSpace = opts.footer?.trim() ? footerSize * 2.6 : 0;

  if (lines.length) {
    const wide = aspect > 1.4;
    const baseSize = unit * (wide ? 0.2 : 0.15) * (opts.scale ?? 1) * (lines.length > 2 ? 0.8 : 1);
    const maxW = w * (wide ? 0.62 : aspect < 0.95 ? 0.8 : 0.7) * Math.min(1.25, opts.scale ?? 1);
    const block = layoutTitle(ctx, lines, maxW, baseSize);
    const scriptSize = baseSize * 0.5;
    const hasScript = Boolean(opts.tagline?.trim());
    const topRoom = hasScript ? scriptSize * 0.7 : 0;
    let cy;
    if (opts.placement === 'top') cy = h * 0.07 + topRoom + block.height / 2;
    else if (opts.placement === 'center') cy = h * 0.5 + topRoom / 2;
    else cy = h - h * 0.07 - footerSpace - block.height / 2;

    ctx.save();
    ctx.translate(w / 2, cy);
    ctx.rotate(((opts.tilt ?? 0) * Math.PI) / 180);

    // A soft dark pool behind the title, so it reads over any photo.
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, block.width * 0.75);
    pool.addColorStop(0, 'rgba(8, 0, 18, 0.5)');
    pool.addColorStop(1, 'rgba(8, 0, 18, 0)');
    ctx.save();
    ctx.scale(1, (block.height * 1.6) / (block.width * 1.5));
    ctx.fillStyle = pool;
    ctx.fillRect(-block.width, -block.width, block.width * 2, block.width * 2);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const each = (fn) => block.lines.forEach((l) => {
      ctx.font = `${l.size}px ${TITLE_FONT}`;
      ctx.letterSpacing = `${l.size * 0.01}px`;
      fn(l);
    });

    // 1. Outer glow and the extruded depth, stepping down and right.
    each((l) => {
      const depth = Math.max(2, Math.round(l.size * 0.075));
      ctx.fillStyle = style.extrude;
      ctx.shadowColor = style.glow;
      ctx.shadowBlur = l.size * 0.35;
      ctx.fillText(l.line, depth * 0.55, l.y + depth);
      ctx.shadowBlur = 0;
      for (let i = depth; i > 0; i--) ctx.fillText(l.line, i * 0.55, l.y + i);
    });
    // 2. The thick ink outline, then a thin inner outline in the accent colour.
    each((l) => {
      ctx.strokeStyle = style.ink;
      ctx.lineWidth = l.size * 0.13;
      ctx.strokeText(l.line, 0, l.y);
    });
    each((l) => {
      ctx.strokeStyle = style.inner;
      ctx.lineWidth = l.size * 0.05;
      if (opts.style === 'neon') {
        ctx.shadowColor = style.glow;
        ctx.shadowBlur = l.size * 0.25;
      }
      ctx.strokeText(l.line, 0, l.y);
      ctx.shadowBlur = 0;
    });
    // 3. The fill: a gradient across each line's own cap height.
    each((l) => {
      ctx.fillStyle = fillGradient(ctx, style, l.y - l.ascent, l.y + l.descent);
      ctx.fillText(l.line, 0, l.y);
    });
    // 4. A sheen: a thin light band across the upper third of each line.
    each((l) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-w, l.y - l.ascent, w * 2, l.ascent * 0.28);
      ctx.clip();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(l.line, 0, l.y);
      ctx.restore();
    });

    if (hasScript) drawScript(ctx, opts.tagline.trim(), style, scriptSize, block);
    ctx.restore();
  }

  if (footerSpace) drawFooter(ctx, opts.footer.trim().toUpperCase(), w, h, footerSize, opts.frame ?? 0);
}

/** The tagline: a tilted script line laid over the title's top-left corner, glowing like a neon sign. */
function drawScript(ctx, text, style, size, block) {
  ctx.save();
  const first = block.lines[0];
  ctx.translate(-block.width / 2 + size * 0.4, first.y - first.ascent - size * 0.05);
  ctx.rotate(-0.12);
  ctx.font = `${size}px ${SCRIPT_FONT}`;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const maxW = block.width * 0.9;
  const tw = ctx.measureText(text).width;
  if (tw > maxW) {
    size *= maxW / tw;
    ctx.font = `${size}px ${SCRIPT_FONT}`;
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10, 2, 20, 0.9)';
  ctx.lineWidth = size * 0.16;
  ctx.strokeText(text, 0, 0);
  ctx.shadowColor = style.scriptGlow;
  ctx.shadowBlur = size * 0.45;
  ctx.fillStyle = style.scriptGlow;
  ctx.fillText(text, 0, 0);
  ctx.shadowBlur = size * 0.12;
  ctx.fillStyle = style.script;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** The footer: small capitals, widely spaced, centred along the foot of the frame on a dark band. */
function drawFooter(ctx, text, w, h, size, frame) {
  ctx.save();
  ctx.font = `${size}px ${TITLE_FONT}`;
  ctx.letterSpacing = `${size * 0.32}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = h - Math.max(frame, size * 0.6) - size * 1.1;
  const tw = Math.min(w * 0.9, ctx.measureText(text).width + size * 2);
  ctx.fillStyle = 'rgba(6, 2, 14, 0.72)';
  ctx.fillRect(w / 2 - tw / 2, y - size * 0.95, tw, size * 1.9);
  ctx.fillStyle = '#fff6ea';
  ctx.fillText(text, w / 2 + size * 0.16, y + size * 0.04);
  ctx.restore();
}
