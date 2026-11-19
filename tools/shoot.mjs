// Takes the entry's screenshots with headless Chrome (Node 22+, no packages):
//   node tools/shoot.mjs [shots.json] [--only name] [--out dir]
// Opens each scene from shots.json and either captures the page (kind "editor") or fetches the PNG the app's exporter
// writes (kind "cover"), saving it whole in <out>/exports/, then scales it into screenshots/ as a JPEG under 256 KiB
// with tools/fit_image.py. Console errors and requests that leave the machine are printed at the end.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, sleep, startSession, waitFor } from './cdp.mjs';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const shotsFile = args[0] && !args[0].startsWith('--') ? args[0] : join(root, 'shots.json');
const only = flag('--only');
const outDir = flag('--out') ?? join(tmpdir(), 'sunset-grid-shots');
mkdirSync(join(outDir, 'exports'), { recursive: true });
mkdirSync(join(root, 'screenshots'), { recursive: true });

const fit = (src, dest, w, h) =>
  execFileSync('python', [join(root, 'tools', 'fit_image.py'), src, dest, String(w), String(h)], { stdio: 'inherit' });

const session = await startSession({ outDir });
try {
  const { cdp } = session;
  const shots = JSON.parse(readFileSync(shotsFile, 'utf8')).filter((s) => !only || s.name === only);
  for (const shot of shots) {
    const [vw, vh] = shot.viewport ?? [1280, 800];
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: session.appUrl + shot.query });
    await sleep(300);
    await waitFor(() => session.eval('window.__shotReady === true'), `scene ${shot.name}`);
    await sleep(250);
    const dest = join(root, 'screenshots', shot.name);
    if (shot.kind === 'cover') {
      const dataUrl = await session.eval(`window.__exportCover(${JSON.stringify(shot.size)})`);
      const full = join(outDir, 'exports', shot.name.replace(/\.\w+$/, '.png'));
      writeFileSync(full, Buffer.from(dataUrl.split(',')[1], 'base64'));
      fit(full, dest, shot.fit[0], shot.fit[1]);
    } else {
      const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const full = join(outDir, 'exports', shot.name.replace(/\.\w+$/, '.page.png'));
      writeFileSync(full, Buffer.from(res.data, 'base64'));
      fit(full, dest, vw, vh);
    }
  }
  const { problems } = session;
  console.log(problems.length ? `problems:\n  ${problems.join('\n  ')}` : 'no console errors, no off-machine requests');
  cdp.close();
} finally {
  session.close();
}
