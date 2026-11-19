// Fixed scenes for the maker's screenshots, set up from the page's query instead of by hand:
//   ?shot=editor&size=wide&layout=mosaic&grade=sunset&photos=boulevard,pier&caption=...&tagline=...&footer=...
//   &crops=0:1:1.4:0.5:0.3;2:0:2:0.4:0.6   (panel:photo:zoom:x:y, overriding the auto-arranged crops)
//   &select=2                              (the panel shown selected in the editor)
// window.__shotReady is set once the preview has painted; window.__exportCover(size) resolves to the exported PNG as
// a data: URL, the bytes the Export button downloads.

import { exportCoverDataURL } from './exporter.js';

const SETTINGS = ['size', 'layout', 'grade', 'caption', 'tagline', 'footer', 'lettering', 'placement', 'frame'];

export async function runShot(query, editor) {
  document.body.classList.add(`shot-${query.get('shot')}`);
  const settings = {};
  for (const key of SETTINGS) if (query.has(key)) settings[key] = query.get(key);
  if (query.has('scale')) settings.captionScale = Number(query.get('scale'));
  if (query.has('tilt')) settings.tilt = Number(query.get('tilt'));
  if (query.has('strength')) settings.gradeStrength = Number(query.get('strength'));
  editor.applySettings(settings);
  const photos = (query.get('photos') ?? 'boulevard').split(',').filter(Boolean);
  await editor.addPhotoUrls(photos.map((p) => `samples/${p}.jpg`));
  for (const spec of (query.get('crops') ?? '').split(';').filter(Boolean)) {
    const [panel, photo, zoom, x, y] = spec.split(':').map(Number);
    editor.setCrop(panel, { photo, zoom, x, y });
  }
  if (query.has('select')) editor.selectPanel(Number(query.get('select')));
  window.__exportCover = (size) => exportCoverDataURL(editor.state, size ?? editor.state.size);
  editor.renderNow();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}
