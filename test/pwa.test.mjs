import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE INSTALLED APP.
//
// Chrome's own installability check (Page.getInstallabilityErrors over the
// DevTools protocol, against the live site) returns no errors, so the app
// already installs. What this file holds is the part that check does not
// look at: what the installed app is like for the people it is for.

const site = new URL('../site/', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, site)));
const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));
const html = read('index.html').toString('utf8');

/** A PNG's header: its size, and whether it can hold transparency at all. */
function pngHeader(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG');
  assert.equal(buf.subarray(12, 16).toString('latin1'), 'IHDR');
  // Colour types 4 and 6 carry an alpha channel; 0, 2 and 3 do not (3 can
  // via a tRNS chunk, which is looked for separately).
  const colourType = buf[25];
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    alpha: colourType === 4 || colourType === 6 || buf.includes(Buffer.from('tRNS')),
  };
}

test('an iPhone gets the polaris mark, not a generated icon', () => {
  // iOS does not accept SVG for apple-touch-icon and fell back to an icon of
  // its own (#165). It wants a PNG, 180x180 for current iPhones.
  const m = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(m, 'no apple-touch-icon link');
  assert.match(m[1], /\.png$/, `apple-touch-icon is ${m[1]}, which iOS ignores unless it is a PNG`);
  const icon = pngHeader(read(m[1]));
  assert.deepEqual([icon.width, icon.height], [180, 180]);
  // iOS paints anything transparent black and applies its own rounded mask,
  // so the icon is square and opaque -- not icon.svg's rounded corners.
  assert.equal(icon.alpha, false, 'the icon can be transparent, which iOS renders black');
});

test('the install sheet shows the app, not one line of text', () => {
  // Android's richer install sheet needs at least one narrow screenshot;
  // desktop Chrome's needs a wide one. Chrome's rules for each: both sides
  // 320-3840px, the long side no more than 2.3 times the short, and every
  // one the same aspect as the others of its form factor.
  const shots = manifest.screenshots || [];
  assert.ok(shots.some((s) => s.form_factor === 'narrow'), 'no phone screenshot');
  assert.ok(shots.some((s) => s.form_factor === 'wide'), 'no wide screenshot');
  for (const s of shots) {
    const png = pngHeader(read(s.src));
    assert.equal(`${png.width}x${png.height}`, s.sizes, `${s.src} is not the size the manifest says`);
    assert.equal(s.type, 'image/png');
    for (const side of [png.width, png.height]) assert.ok(side >= 320 && side <= 3840, `${s.src}: ${side}px`);
    const ratio = Math.max(png.width, png.height) / Math.min(png.width, png.height);
    assert.ok(ratio <= 2.3, `${s.src} is ${ratio.toFixed(2)}:1`);
    assert.equal(s.form_factor, png.width > png.height ? 'wide' : 'narrow', `${s.src} form factor`);
    // A screenshot is an image, and the install sheet reads its label out.
    assert.ok(s.label && s.label.length > 20, `${s.src} has no real label`);
  }
});

test('the screenshots are the ones the script draws, with its words', async () => {
  // One list, in scripts/capture-pwa-images.mjs, so the labels cannot drift
  // from the pictures the script actually takes.
  const { SHOTS } = await import('../scripts/capture-pwa-images.mjs');
  assert.deepEqual(
    manifest.screenshots.map((s) => [s.src, s.label]),
    SHOTS.map((s) => [`screenshots/${s.file}`, s.label]));
});

test('the screenshots are not in the offline cache', () => {
  // Only the install sheet shows them, and it fetches them online. Adding
  // 600KB to every visitor's offline copy would buy nothing.
  const sw = read('sw.js').toString('utf8');
  assert.ok(!/screenshots\//.test(sw), 'the service worker precaches the screenshots');
});

test('the installed app turns with the phone', () => {
  // WCAG 2.1 SC 1.3.4 (Orientation, AA): content is not restricted to one
  // orientation unless that is essential. It is not essential here -- the
  // sky view already corrects for screen rotation -- and the lock made the
  // installed app unusable for anyone whose phone sits in a fixed landscape
  // mount, such as on a wheelchair (#166). A browser tab was never locked;
  // only the home-screen app was, which is the one those people would use.
  assert.ok(!('orientation' in manifest),
    `the manifest locks orientation to "${manifest.orientation}"`);
});
