// Render the installed app's images from the app itself.
//
//     npm run serve                 # in one terminal: http://localhost:8790
//     npm run pwa-images            # in another; needs a local Chrome or Edge
//
// Writes:
//   site/src/data/apple-touch-icon.png   the iPhone home-screen icon
//   site/screenshots/*.png               the install sheet's screenshots
//
// WHY A SCRIPT RATHER THAN SAVED FILES. Both are pictures of something that
// changes -- the icon of icon.svg, the screenshots of the app -- and a picture
// nobody can regenerate is one that quietly stops matching what it shows.
//
// THE ICON IS icon.svg WITH ITS CORNERS SQUARED. iOS applies its own rounded
// mask to a home-screen icon and paints anything transparent black, and it
// does not accept SVG at all (#165). So the same drawing, full bleed, 180x180,
// on an opaque background.
//
// THE SCREENSHOTS ARE OF A FIXED NIGHT at a fixed place, so running this again
// draws the same sky rather than whatever is up at the moment -- in daylight
// that would be nothing. The app never stores a planned night (see plannedFor
// in app.js), so the clock is pinned here instead, before the page's own
// scripts run. Nothing about the app changes; only this browser's clock.
//
// Set CHROME to a browser binary if it is not in one of the usual places, and
// BASE if the app is served somewhere other than http://localhost:8790.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:8790';
const PORT = 9339;

/** Dallas, 22:30 local on 10 October 2026: the Dipper low, Cassiopeia high. */
export const PLACE = { lat: 32.8, lon: -96.8, altitude: 150 };
export const NIGHT = Date.UTC(2026, 9, 11, 3, 30);

/** The phone shots and the one desktop shot, with the words a screen reader says. */
export const SHOTS = [
  { file: 'phone-tracker.png', w: 390, h: 844, dpr: 2, night: false,
    label: 'The numbers to set your tracker to, with Polaris drawn on the polar-scope reticle',
    setup: `document.getElementById('modeAlignBtn').click(); await wait(600);
            const c = document.getElementById('settingsCard'); c.open = true; await wait(300);
            c.scrollIntoView(); scrollBy(0, -(document.querySelector('.bar').offsetHeight + 8));` },
  { file: 'phone-sky.png', w: 390, h: 844, dpr: 2, night: false,
    label: 'The live sky view, with the stars and constellations above the horizon tonight',
    setup: `const c = document.getElementById('skyCard'); c.open = true;
            for (let i = 0; i < 2; i++) { document.getElementById('skyWider').click(); await wait(300); }
            c.scrollIntoView(); scrollBy(0, -(document.querySelector('.bar').offsetHeight + 8));` },
  { file: 'phone-night.png', w: 390, h: 844, dpr: 2, night: true,
    label: 'Full-screen sky view in Night Mode: pure red on black, to keep your eyes dark-adapted',
    setup: `document.getElementById('fullBtn').click(); await wait(500);
            for (let i = 0; i < 2; i++) { document.getElementById('fullOut').click(); await wait(300); }` },
  { file: 'desktop-sky.png', w: 1280, h: 800, dpr: 1, night: false, wide: true,
    label: 'Full-screen sky view on a wide screen, with the controls at the edges',
    setup: `document.getElementById('fullBtn').click(); await wait(500);
            for (let i = 0; i < 2; i++) { document.getElementById('fullOut').click(); await wait(300); }` },
];

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found. Set CHROME to a browser binary.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let targets;
  for (let i = 0; i < 60 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); }
    catch { await sleep(250); }
  }
  if (!targets) throw new Error('The browser never opened its debugging port.');
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { ws, send };
}

async function png(send, file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`wrote ${file.replace(ROOT, '')}`);
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'polaris-shots-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const { ws, send } = await connect();
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 8, g: 11, b: 20, a: 1 } });

    // The icon: icon.svg with its corners squared, 180x180, opaque.
    const svg = readFileSync(join(ROOT, 'site/src/data/icon.svg'), 'utf8')
      .replace(/\s+rx="[^"]*"/, '')
      .replace('<svg ', '<svg width="180" height="180" ');
    await send('Emulation.setDeviceMetricsOverride', { width: 180, height: 180, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', {
      frameId: frameTree.frame.id,
      html: `<!doctype html><body style="margin:0;background:#080b14">${svg}</body>`,
    });
    await sleep(300);
    await png(send, join(ROOT, 'site/src/data/apple-touch-icon.png'));

    // The screenshots, at a pinned night.
    mkdirSync(join(ROOT, 'site/screenshots'), { recursive: true });
    for (const shot of SHOTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: shot.w, height: shot.h, deviceScaleFactor: shot.dpr, mobile: !shot.wide,
      });
      const seed = { site: PLACE, scale: 1, night: shot.night, trackOpen: false, mode: 'sky' };
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        (() => {
          const offset = ${NIGHT} - Date.now();
          const Real = Date;
          class Pinned extends Real {
            constructor(...a) { super(...(a.length ? a : [Real.now() + offset])); }
            static now() { return Real.now() + offset; }
          }
          globalThis.Date = Pinned;
          if (location.origin === ${JSON.stringify(new URL(BASE).origin)}) {
            for (const [k, v] of Object.entries(${JSON.stringify(seed)})) {
              localStorage.setItem('polaris.' + k, JSON.stringify(v));
            }
          }
        })();` });
      await send('Page.navigate', { url: `${BASE}/` });
      await sleep(3500);
      await send('Runtime.evaluate', {
        expression: `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); ${shot.setup} })()`,
        awaitPromise: true,
      });
      await sleep(1500);
      await png(send, join(ROOT, 'site/screenshots', shot.file));
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
    ws.close();
  } finally {
    chrome.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
