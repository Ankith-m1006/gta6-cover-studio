// Sunset Grid, the editor. Load photos from this machine (picker, drag and drop, or the samples), and the cover fills
// every panel at once with varied crops; click a panel to pick it, drag to pan its photo, scroll or use the slider to
// zoom, choose its photo, then set layout, grade and caption and export a PNG at 1920x1080, 1080x1080 or 1080x1350.
// Photos are read with object URLs in this tab and never leave the machine.

import { LAYOUTS, buildPanels, layoutById, panelCount, pointInPoly, tracePoly } from './layouts.js';
import { GRADES, GRADE_IDS, gradeSwatchCss } from './grades.js';
import { LETTERING, SCRIPT_FONT, TITLE_FONT } from './lettering.js';
import { clampCrop, photoPlacement, renderCover } from './render.js';
import { SIZES, downloadCoverPNG } from './exporter.js';
import { runShot } from './shots.js';
import { findSubject, subjectCrop } from './subject.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The whole cover, as the editor edits it and renderCover draws it. */
const state = {
  photos: [],
  panels: [],
  size: 'wide',
  layoutId: 'mosaic',
  gradeId: 'sunset',
  gradeStrength: 1,
  frame: 'dark',
  gutter: 0.014,
  caption: 'Sunset Hustle',
  tagline: 'Ocean Drive',
  footer: 'Coming soon',
  placement: 'auto',
  captionScale: 1,
  tilt: -3,
  lettering: 'auto',
  seed: 7,
};

const preview = $('preview');
let geometry = [];
let selected = 0;
let drag = null;
let frameQueued = false;

/** The crop for a photo's n-th panel, framed around the subject point findSubject found in it. */
function cropFor(photoIndex, n) {
  const photo = state.photos[photoIndex];
  return { photo: photoIndex, ...subjectCrop(photo?.subject ?? { x: 0.5, y: 0.35 }, n) };
}

// ---------- photos ----------

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not read ${url}`));
    img.src = url;
  });
}

/** Adds photos from files the user picked or dropped; read in the browser, never uploaded. */
async function addPhotoFiles(files, dropPanel = -1) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    setStatus('That was not an image file. Try a JPEG, PNG or WebP photo.');
    return;
  }
  const added = [];
  for (const file of images) {
    try {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      added.push({ img, name: file.name, url, subject: findSubject(img) });
    } catch {
      setStatus(`Could not open ${file.name}.`);
    }
  }
  addPhotos(added, dropPanel);
}

async function addPhotoUrls(urls) {
  const added = [];
  for (const url of urls) {
    const img = await loadImage(url);
    added.push({ img, name: url.split('/').pop(), url, subject: findSubject(img) });
  }
  addPhotos(added, -1);
}

function addPhotos(added, dropPanel) {
  if (!added.length) return;
  const first = state.photos.length;
  state.photos.push(...added);
  if (dropPanel >= 0 && added.length === 1 && first > 0) {
    state.panels[dropPanel] = cropFor(first, 0);
    selectPanel(dropPanel);
  } else {
    autoArrange();
  }
  setStatus(`${state.photos.length} photo${state.photos.length > 1 ? 's' : ''} loaded. Drag a panel to reframe it.`);
  refreshPhotoLists();
  scheduleRender();
}

function removePhoto(index) {
  state.photos.splice(index, 1);
  state.panels.forEach((p) => {
    if (!p) return;
    if (p.photo === index) p.photo = state.photos.length ? index % state.photos.length : null;
    else if (p.photo > index) p.photo -= 1;
  });
  if (!state.photos.length) state.panels = [];
  refreshPhotoLists();
  scheduleRender();
}

// ---------- panels ----------

function currentGeometry() {
  const s = SIZES[state.size];
  return buildPanels(layoutById(state.layoutId), s.w, s.h, Math.round(Math.min(s.w, s.h) * state.gutter));
}

/**
 * Fills every panel: the largest panels take the photos in turn, each photo's first panel a wide crop and its
 * repeats tighter close-ups, so one photo or several make a full grid at once.
 */
function autoArrange() {
  const n = panelCount(layoutById(state.layoutId));
  state.panels = [];
  if (!state.photos.length) return;
  const geo = currentGeometry();
  const order = geo.map((p, i) => [p.area, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const uses = new Array(state.photos.length).fill(0);
  order.forEach((panelIndex, rank) => {
    const photo = rank % state.photos.length;
    state.panels[panelIndex] = cropFor(photo, uses[photo]++);
  });
  for (let i = 0; i < n; i++) if (!state.panels[i]) state.panels[i] = cropFor(0, i);
  clampAllCrops();
}

/** Keeps the panel list as long as the layout, filling new panels from the photos. */
function fitPanelsToLayout() {
  const n = panelCount(layoutById(state.layoutId));
  if (!state.photos.length) {
    state.panels = [];
    return;
  }
  for (let i = state.panels.length; i < n; i++) {
    state.panels[i] = cropFor(i % state.photos.length, i);
  }
  state.panels.length = n;
  selected = clamp(selected, 0, n - 1);
  clampAllCrops();
}

function clampAllCrops() {
  const geo = currentGeometry();
  state.panels.forEach((crop, i) => {
    const photo = crop && state.photos[crop.photo];
    if (photo && geo[i]) clampCrop(photo.img, geo[i].box, crop);
  });
}

function setCrop(panel, crop) {
  if (!state.panels[panel]) return;
  Object.assign(state.panels[panel], crop);
  clampAllCrops();
  scheduleRender();
}

function selectPanel(index) {
  selected = clamp(index, 0, Math.max(0, panelCount(layoutById(state.layoutId)) - 1));
  refreshPanelInspector();
  scheduleRender();
}

// ---------- preview ----------

function scheduleRender() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    renderNow();
  });
}

/** Sizes the preview canvas to the stage at the cover's aspect, then draws the cover and the selected panel. */
function renderNow() {
  const s = SIZES[state.size];
  const wrap = preview.parentElement;
  const availW = Math.max(200, wrap.clientWidth - 8);
  const availH = Math.max(200, wrap.clientHeight - 8);
  const cssScale = Math.min(availW / s.w, availH / s.h);
  const cssW = Math.floor(s.w * cssScale);
  const cssH = Math.floor(s.h * cssScale);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxScale = Math.min(1, (cssW * dpr) / s.w, 1400 / Math.max(s.w, s.h));
  const pw = Math.round(s.w * pxScale);
  const ph = Math.round(s.h * pxScale);
  if (preview.width !== pw || preview.height !== ph) {
    preview.width = pw;
    preview.height = ph;
  }
  preview.style.width = `${cssW}px`;
  preview.style.height = `${cssH}px`;
  geometry = renderCover(preview, state);
  drawSelection();
  $('emptyStage').hidden = state.photos.length > 0;
}

function drawSelection() {
  const panel = geometry[selected];
  if (!panel || !state.photos.length || geometry.length < 2) return;
  const ctx = preview.getContext('2d');
  const lw = Math.max(2, preview.width / 400);
  ctx.save();
  tracePoly(ctx, panel.poly);
  ctx.lineWidth = lw * 2.2;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.stroke();
  ctx.setLineDash([lw * 5, lw * 3]);
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#ffe36e';
  ctx.stroke();
  ctx.restore();
}

function canvasPoint(e) {
  const r = preview.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * preview.width, ((e.clientY - r.top) / r.height) * preview.height];
}

function panelAt(pt) {
  return geometry.findIndex((p) => pointInPoly(pt, p.poly));
}

function bindPreviewGestures() {
  preview.addEventListener('pointerdown', (e) => {
    const pt = canvasPoint(e);
    const index = panelAt(pt);
    if (index < 0) return;
    selectPanel(index);
    if (!state.photos.length) {
      $('photoInput').click();
      return;
    }
    drag = { id: e.pointerId, last: pt };
    preview.setPointerCapture(e.pointerId);
    preview.classList.add('dragging');
  });
  preview.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const pt = canvasPoint(e);
    const crop = state.panels[selected];
    const photo = crop && state.photos[crop.photo];
    const panel = geometry[selected];
    if (photo && panel) {
      const { dw, dh } = photoPlacement(photo.img, panel.box, crop);
      crop.x -= (pt[0] - drag.last[0]) / dw;
      crop.y -= (pt[1] - drag.last[1]) / dh;
      clampCrop(photo.img, panel.box, crop);
      scheduleRender();
    }
    drag.last = pt;
  });
  const endDrag = () => {
    drag = null;
    preview.classList.remove('dragging');
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
  preview.addEventListener('wheel', (e) => {
    const index = panelAt(canvasPoint(e));
    if (index < 0 || !state.photos.length) return;
    e.preventDefault();
    if (index !== selected) selectPanel(index);
    zoomSelected(state.panels[selected].zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  preview.addEventListener('dblclick', () => {
    const crop = state.panels[selected];
    if (!crop) return;
    Object.assign(crop, cropFor(crop.photo, 0));
    clampAllCrops();
    refreshPanelInspector();
    scheduleRender();
  });
  window.addEventListener('resize', scheduleRender);
}

function zoomSelected(zoom) {
  const crop = state.panels[selected];
  if (!crop) return;
  crop.zoom = clamp(zoom, 1, 5);
  clampAllCrops();
  $('panelZoom').value = crop.zoom;
  scheduleRender();
}

function bindDropTargets() {
  const stage = $('stage');
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('drop-over');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) stage.classList.remove('drop-over');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop-over');
    if (!e.dataTransfer?.files?.length) return;
    const onCanvas = e.target === preview ? panelAt(canvasPoint(e)) : -1;
    addPhotoFiles(e.dataTransfer.files, onCanvas);
  });
}

// ---------- side panels ----------

function setStatus(text) {
  $('status').textContent = text;
}

function makeButton(className, html, onClick, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.innerHTML = html;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function refreshPhotoLists() {
  const list = $('photoList');
  list.replaceChildren();
  state.photos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'thumb';
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = p.name;
    item.append(img, makeButton('thumb-remove', '×', () => removePhoto(i), `Remove ${p.name}`));
    list.append(item);
  });
  $('photoCount').textContent = state.photos.length ? `${state.photos.length} loaded` : 'none yet';
  refreshPanelInspector();
}

function refreshPanelInspector() {
  const pick = $('panelPhotoPick');
  pick.replaceChildren();
  const crop = state.panels[selected];
  $('panelTitle').textContent = `Panel ${selected + 1} of ${panelCount(layoutById(state.layoutId))}`;
  state.photos.forEach((p, i) => {
    const b = makeButton(`thumb pick${crop?.photo === i ? ' active' : ''}`, '', () => {
      state.panels[selected] = cropFor(i, selected);
      clampAllCrops();
      refreshPanelInspector();
      scheduleRender();
    }, `Put ${p.name} in this panel`);
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = '';
    b.append(img);
    pick.append(b);
  });
  $('panelZoom').value = crop?.zoom ?? 1;
  $('panelControls').classList.toggle('disabled', !state.photos.length);
}

function buildLayoutButtons() {
  const list = $('layoutList');
  list.replaceChildren();
  const s = SIZES[state.size];
  const tw = 72;
  const th = Math.round((tw * s.h) / s.w);
  for (const layout of LAYOUTS) {
    const b = makeButton(`layout-btn${layout.id === state.layoutId ? ' active' : ''}`, '', () => {
      state.layoutId = layout.id;
      fitPanelsToLayout();
      autoArrange();
      buildLayoutButtons();
      refreshPanelInspector();
      scheduleRender();
    }, layout.name);
    const c = document.createElement('canvas');
    c.width = tw * 2;
    c.height = th * 2;
    const ctx = c.getContext('2d');
    buildPanels(layout, c.width, c.height, 5).forEach((p, i) => {
      tracePoly(ctx, p.poly);
      ctx.fillStyle = i === 0 ? '#ff5f8f' : i % 2 ? '#7b3cc4' : '#ff9c4a';
      ctx.fill();
    });
    const label = document.createElement('span');
    label.textContent = layout.name;
    b.append(c, label);
    list.append(b);
  }
}

function buildGradeButtons() {
  const list = $('gradeList');
  list.replaceChildren();
  for (const id of GRADE_IDS) {
    const g = GRADES[id];
    const b = makeButton(`grade-btn${id === state.gradeId ? ' active' : ''}`,
      `<span class="swatch" style="background:${gradeSwatchCss(id)}"></span><b>${g.name}</b><small>${g.note}</small>`,
      () => {
        state.gradeId = id;
        buildGradeButtons();
        scheduleRender();
      });
    list.append(b);
  }
}

function buildSizeButtons() {
  const list = $('sizeButtons');
  list.replaceChildren();
  for (const [id, s] of Object.entries(SIZES)) {
    const b = makeButton(`size-btn${id === state.size ? ' active' : ''}`,
      `<i class="aspect" style="aspect-ratio:${s.w}/${s.h}"></i><span><b>${s.label}</b><small>${s.note}</small></span>`,
      () => {
        state.size = id;
        clampAllCrops();
        buildSizeButtons();
        buildLayoutButtons();
        scheduleRender();
      });
    b.setAttribute('aria-pressed', String(id === state.size));
    list.append(b);
  }
  $('exportBtn').innerHTML = `Export PNG <small>${SIZES[state.size].label}</small>`;
}

function buildLetteringOptions() {
  const select = $('lettering');
  select.replaceChildren(new Option('Auto (grade)', 'auto'));
  for (const [id, l] of Object.entries(LETTERING)) select.append(new Option(l.name, id));
  select.value = state.lettering;
}

/** Binds an input to a state field; `read` turns the input's value into the field's value. */
function bindField(id, key, read = (v) => v) {
  const el = $(id);
  el.value = state[key];
  el.addEventListener('input', () => {
    state[key] = read(el.value);
    scheduleRender();
  });
}

function syncFields() {
  for (const [id, key] of [['caption', 'caption'], ['tagline', 'tagline'], ['footer', 'footer'], ['lettering', 'lettering'],
    ['placement', 'placement'], ['captionScale', 'captionScale'], ['tilt', 'tilt'], ['gradeStrength', 'gradeStrength'],
    ['frame', 'frame'], ['gutter', 'gutter']]) $(id).value = state[key];
}

function bindControls() {
  $('photoInput').addEventListener('change', (e) => {
    addPhotoFiles(e.target.files);
    e.target.value = '';
  });
  $('stageAdd').addEventListener('click', () => $('photoInput').click());
  $('sampleBtn').addEventListener('click', () => addPhotoUrls(['samples/boulevard.jpg', 'samples/pier.jpg']));
  bindField('caption', 'caption');
  bindField('tagline', 'tagline');
  bindField('footer', 'footer');
  bindField('lettering', 'lettering');
  bindField('placement', 'placement');
  bindField('captionScale', 'captionScale', Number);
  bindField('tilt', 'tilt', Number);
  bindField('gradeStrength', 'gradeStrength', Number);
  bindField('frame', 'frame');
  $('gutter').value = state.gutter;
  $('gutter').addEventListener('input', () => {
    state.gutter = Number($('gutter').value);
    clampAllCrops();
    scheduleRender();
  });
  $('panelZoom').addEventListener('input', () => zoomSelected(Number($('panelZoom').value)));
  $('resetCrop').addEventListener('click', () => {
    if (!state.panels[selected]) return;
    Object.assign(state.panels[selected], cropFor(state.panels[selected].photo, 0));
    clampAllCrops();
    refreshPanelInspector();
    scheduleRender();
  });
  $('fillAll').addEventListener('click', () => {
    const photo = state.panels[selected]?.photo;
    if (photo == null) return;
    state.panels = state.panels.map((_, i) => cropFor(photo, i));
    clampAllCrops();
    refreshPanelInspector();
    scheduleRender();
  });
  $('autoArrange').addEventListener('click', () => {
    autoArrange();
    refreshPanelInspector();
    scheduleRender();
  });
  $('exportBtn').addEventListener('click', () => exportSizes([state.size]));
  $('exportAllBtn').addEventListener('click', () => exportSizes(Object.keys(SIZES)));
}

async function exportSizes(sizeIds) {
  const names = [];
  for (const id of sizeIds) {
    setStatus(`Rendering ${SIZES[id].label}…`);
    names.push(await downloadCoverPNG(state, id));
  }
  setStatus(`Saved ${names.join(', ')}`);
}

/** Applies a set of settings (from a screenshot scene) and rebuilds the controls to match. */
function applySettings(settings) {
  const map = { size: 'size', layout: 'layoutId', grade: 'gradeId' };
  for (const [k, v] of Object.entries(settings)) state[map[k] ?? k] = v;
  syncFields();
  buildSizeButtons();
  buildLayoutButtons();
  buildGradeButtons();
  fitPanelsToLayout();
}

async function start() {
  await Promise.all([document.fonts.load(`80px ${TITLE_FONT}`), document.fonts.load(`80px ${SCRIPT_FONT}`)]);
  buildLetteringOptions();
  buildSizeButtons();
  buildLayoutButtons();
  buildGradeButtons();
  bindControls();
  bindPreviewGestures();
  bindDropTargets();
  refreshPhotoLists();
  const query = new URLSearchParams(location.search);
  if (query.get('shot')) {
    await runShot(query, { state, applySettings, addPhotoUrls, setCrop, selectPanel, renderNow });
  } else {
    scheduleRender();
  }
}

start();
