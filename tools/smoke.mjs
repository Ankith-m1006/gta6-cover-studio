// Uses the editor the way a person would, in headless Chrome, and checks each step (Node 22+, no packages):
//   node tools/smoke.mjs [--out dir]
// Loads a photo from disk through the real file input, checks every panel got it, drags a panel to pan its photo,
// scrolls to zoom it, edits the caption, switches layout, grade and size, clicks Export for each size and checks the
// downloaded PNGs' pixel sizes, and fails on any console error or request that leaves the machine.

import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, sleep, startSession, waitFor } from './cdp.mjs';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(tmpdir(), 'sunset-grid-smoke');
const downloads = join(outDir, 'downloads');
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

function pngSize(file) {
  const b = readFileSync(file);
  return b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}

const session = await startSession({ outDir, appPort: 8092, cdpPort: 9340 });
const { cdp } = session;
const js = session.eval;
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await cdp.send('Page.navigate', { url: session.appUrl });
  await waitFor(() => js(`document.querySelectorAll('.layout-btn').length > 0`), 'the editor');
  check(await js(`!document.getElementById('emptyStage').hidden`), 'empty state invites a photo');

  // 1. A photo from disk, through the file input.
  const { root: doc } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#photoInput' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [join(root, 'app', 'samples', 'pier.jpg')] });
  await waitFor(() => js(`document.querySelectorAll('#photoList .thumb').length === 1`), 'the photo to load');
  await sleep(200);
  check(await js(`document.getElementById('emptyStage').hidden`), 'photo loaded, empty state gone');
  check(await js(`document.querySelectorAll('#panelPhotoPick .thumb').length === 1`), 'panel inspector lists the photo');

  // 2. Drag the first panel: its crop should move.
  const pt = await js(`(() => { const r = document.getElementById('preview').getBoundingClientRect();
    return { x: r.left + r.width * 0.12, y: r.top + r.height * 0.25 }; })()`);
  const before = await js(`document.getElementById('panelTitle').textContent`);
  const shotA = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  await mouse('mousePressed', pt.x, pt.y);
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', pt.x + i * 6, pt.y + i * 4);
  await mouse('mouseReleased', pt.x + 48, pt.y + 32);
  await sleep(150);
  const shotB = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  check(shotA !== shotB, `dragging ${before} pans its photo (preview changed)`);

  // 3. Scroll to zoom.
  const zoomBefore = Number(await js(`document.getElementById('panelZoom').value`));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY: -400 });
  await sleep(150);
  const zoomAfter = Number(await js(`document.getElementById('panelZoom').value`));
  check(zoomAfter > zoomBefore, `scrolling zooms the panel (${zoomBefore} -> ${zoomAfter.toFixed(2)})`);

  // 4. Caption, layout, grade.
  await js(`(() => { const c = document.getElementById('caption'); c.value = 'Smoke Test\\nCity'; c.dispatchEvent(new Event('input')); })()`);
  await js(`[...document.querySelectorAll('.layout-btn')].find((b) => b.title === 'Triptych').click()`);
  await js(`[...document.querySelectorAll('.grade-btn')][2].click()`);
  await sleep(150);
  check(await js(`document.querySelector('.layout-btn.active').title === 'Triptych'`), 'layout switches');
  check(await js(`document.querySelector('.grade-btn.active b').textContent === 'VHS Tape'`), 'grade switches');

  // 5. Export each size through the buttons.
  const sizes = await js(`[...document.querySelectorAll('.size-btn')].map((b) => b.querySelector('b').textContent)`);
  for (let i = 0; i < sizes.length; i++) {
    await js(`document.querySelectorAll('.size-btn')[${i}].click()`);
    await sleep(100);
    await js(`document.getElementById('exportBtn').click()`);
    await waitFor(() => js(`document.getElementById('status').textContent.startsWith('Saved')`), 'the export');
    await js(`document.getElementById('status').textContent = ''`);
  }
  await sleep(800);
  const files = readdirSync(downloads).filter((f) => f.endsWith('.png'));
  const got = files.map((f) => pngSize(join(downloads, f))?.join('x')).sort();
  check(JSON.stringify(got) === JSON.stringify(['1080x1080', '1080x1350', '1920x1080']), `exported PNGs: ${files.join(', ')} (${got.join(', ')})`);

  check(session.problems.length === 0, session.problems.length ? `problems:\n  ${session.problems.join('\n  ')}` : 'no console errors, no off-machine requests');
} finally {
  cdp.close();
  session.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
