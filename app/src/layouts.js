// Panel layouts for the cover. Each layout is a split tree over the cover's art area: a node cuts its region into
// parts along x or y, each cut tilted a little so the gutters run on the slant like a poster grid. Panels come out as
// convex polygons, so one layout reads well at 1:1, 4:5 and 16:9 (a portrait cover swaps the tree's axes unless the
// layout gives a tree of its own for it).

const X = (weights, tilt = 0, kids) => ({ axis: 'x', weights, tilt, kids });
const Y = (weights, tilt = 0, kids) => ({ axis: 'y', weights, tilt, kids });

/** The layouts the editor offers, in the order it shows them. `caption` is where the title sits by default. */
export const LAYOUTS = [
  {
    id: 'mosaic',
    name: 'Mosaic',
    caption: 'center',
    captionTall: 'bottom',
    wide: X([0.29, 0.42, 0.29], 0.06, [
      Y([0.56, 0.44], -0.05),
      Y([0.62, 0.38], 0.03, [null, X([1, 1], -0.12)]),
      Y([0.4, 0.6], 0.05),
    ]),
    tall: Y([0.3, 0.4, 0.3], -0.04, [
      X([0.55, 0.45], 0.08),
      X([0.62, 0.38], -0.06, [null, Y([1, 1], 0.1)]),
      X([0.42, 0.58], 0.08),
    ]),
  },
  {
    id: 'hero',
    name: 'Hero 3',
    caption: 'bottom',
    wide: X([0.6, 0.4], 0.08, [null, Y([1, 1, 1], -0.06)]),
    tall: Y([0.62, 0.38], -0.05, [null, X([1, 1, 1], 0.12)]),
  },
  {
    id: 'grid4',
    name: 'Grid 4',
    caption: 'center',
    wide: X([1, 1], 0.05, [Y([1.1, 0.9], -0.04), Y([0.9, 1.1], -0.04)]),
  },
  {
    id: 'triptych',
    name: 'Triptych',
    caption: 'bottom',
    wide: X([1, 1.2, 1], 0.16),
    tall: Y([1, 1.2, 1], -0.1),
  },
  {
    id: 'strip',
    name: 'Strip',
    caption: 'center',
    wide: Y([0.68, 0.32], -0.03, [null, X([1, 1, 1, 1], 0.14)]),
    tall: Y([0.6, 0.4], -0.04, [null, X([1, 1], 0.1, [Y([1, 1], -0.08), Y([1, 1], -0.08)])]),
  },
  {
    id: 'slash',
    name: 'Slash',
    caption: 'bottom',
    wide: X([1, 1], 0.4),
    tall: Y([1, 1], -0.35),
  },
  {
    id: 'solo',
    name: 'Solo',
    caption: 'bottom',
    wide: null,
  },
];

/** Where the title sits on a layout at an aspect ratio, when the user leaves it on the layout's default. */
export function captionPlacement(layout, aspect) {
  return aspect < 0.95 && layout.captionTall ? layout.captionTall : layout.caption;
}

export function layoutById(id) {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}

function swapAxes(node) {
  if (!node) return node;
  return { ...node, axis: node.axis === 'x' ? 'y' : 'x', tilt: -node.tilt, kids: node.kids?.map(swapAxes) };
}

/** Picks the tree for an aspect ratio: wide and square covers use `wide`, portrait ones `tall` (or `wide` swapped). */
function treeForAspect(layout, aspect) {
  if (aspect >= 0.95) return layout.wide;
  return 'tall' in layout ? layout.tall : swapAxes(layout.wide);
}

/** Counts the panels a layout makes. */
export function panelCount(layout) {
  const count = (node) => (node ? (node.kids ?? node.weights.map(() => null)).reduce((n, k) => n + count(k), 0) : 1);
  return count(layout.wide);
}

/**
 * Builds the panel polygons of `layout` for a w x h cover with `gutter` pixels between panels (and around them).
 * Returns [{ poly: [[x, y], ...], box: {x, y, w, h}, area }], in the tree's order.
 */
export function buildPanels(layout, w, h, gutter) {
  const m = gutter;
  const rect = [[m, m], [w - m, m], [w - m, h - m], [m, h - m]];
  const polys = [];
  splitRegion(rect, treeForAspect(layout, w / h), gutter, polys);
  return polys.map((poly) => ({ poly, box: polyBox(poly), area: polyArea(poly) }));
}

function splitRegion(poly, node, gutter, out) {
  if (!node) {
    out.push(poly);
    return;
  }
  const b = polyBox(poly);
  const kids = node.kids ?? node.weights.map(() => null);
  const total = node.weights.reduce((a, v) => a + v, 0);
  const cuts = [];
  let acc = 0;
  for (let i = 0; i < node.weights.length - 1; i++) {
    acc += node.weights[i];
    cuts.push(acc / total);
  }
  // Each cut is a line through the region; its normal points to the side of the parts that come after it.
  const cutLine = (c) => {
    if (node.axis === 'x') {
      const x = b.x + c * b.w;
      const off = (node.tilt * b.h) / 2;
      return normalLine([x - off, b.y], [x + off, b.y + b.h], [1, 0]);
    }
    const y = b.y + c * b.h;
    const off = (node.tilt * b.w) / 2;
    return normalLine([b.x, y + off], [b.x + b.w, y - off], [0, 1]);
  };
  kids.forEach((kid, i) => {
    let part = poly;
    if (i > 0) {
      const L = cutLine(cuts[i - 1]);
      part = clipHalfPlane(part, L.p, L.n, gutter / 2);
    }
    if (i < kids.length - 1) {
      const L = cutLine(cuts[i]);
      part = clipHalfPlane(part, L.p, [-L.n[0], -L.n[1]], gutter / 2);
    }
    if (part.length >= 3) splitRegion(part, kid, gutter, out);
  });
}

function normalLine(p, q, towards) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  let n = [dy / len, -dx / len];
  if (n[0] * towards[0] + n[1] * towards[1] < 0) n = [-n[0], -n[1]];
  return { p, n };
}

/** Sutherland-Hodgman: keeps the part of a convex polygon at signed distance >= min from the line (p, normal n). */
function clipHalfPlane(poly, p, n, min) {
  const out = [];
  const f = (pt) => (pt[0] - p[0]) * n[0] + (pt[1] - p[1]) * n[1] - min;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polyBox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** Ray-casting point-in-polygon test, for picking the panel under the pointer. */
export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Traces a polygon as the context's current path. */
export function tracePoly(ctx, poly) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}
