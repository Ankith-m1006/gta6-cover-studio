// A headless Chrome session over the DevTools protocol for the tools here (Node 22+, no packages): serves app/ with
// serve.ts, starts Chrome, opens one page and records console errors, exceptions and any request that leaves
// localhost, since the app must make none.

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, what, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const opened = new Promise((resolve) => (ws.onopen = resolve));
  return {
    opened,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

/** Starts the app server and Chrome; resolves to { cdp, eval, problems, appUrl, close }. */
export async function startSession({ outDir, appPort = 8091, cdpPort = 9339 }) {
  const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const server = spawn(process.execPath, [join(root, 'serve.ts'), '--port', String(appPort)], { stdio: 'ignore' });
  const profile = join(outDir, 'profile');
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const browser = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--force-color-profile=srgb', 'about:blank',
  ], { stdio: 'ignore' });
  const close = () => {
    browser.kill();
    server.kill();
  };
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${appPort}/`).then((r) => r.ok), 'the app server');
    const target = await waitFor(
      () => fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()),
      'Chrome');
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.opened;
    const problems = [];
    cdp.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const e = msg.params.exceptionDetails;
        problems.push(`exception: ${e.exception?.description ?? e.text}`);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params.request.url;
        if (!/^(https?:\/\/(localhost|127\.0\.0\.1):\d+\/|data:|blob:|about:)/.test(url)) problems.push(`off-machine request: ${url}`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    const evaluate = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(`${expression}: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
      return res.result.value;
    };
    return { cdp, eval: evaluate, problems, appUrl: `http://localhost:${appPort}/`, close };
  } catch (err) {
    close();
    throw err;
  }
}
