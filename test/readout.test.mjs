import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compassPoint } from '../site/src/words.js';

// THE NUMBERS ON THE PICTURE.
//
// "What do you think about us having real-time numbers for an output of
// direction and azimuth? Could be cool for users but could help us debug
// also." Both, as it turns out: every rotation bug in the drag was diagnosed
// by scraping "Looking N° round and M° up" out of a hidden hint with synthetic
// pointer events. Now the pair is on a plate over the picture, in both modes:
// bottom centre windowed, above the arrow pad in full screen.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');

const block = (sel) => {
  const at = css.indexOf(sel);
  assert.notEqual(at, -1, `${sel} is missing from the stylesheet`);
  return css.slice(at, css.indexOf('}', at));
};

test('the plate exists, with a slot for each number, and is not a live region', () => {
  assert.match(html, /<div class="sky-readout" id="skyReadout" hidden>/);
  assert.match(html, /id="rdAz"/); assert.match(html, /id="rdAlt"/);
  // It changes every frame. A live region here would talk over everything;
  // the mode hint under the map already announces the position when a hand
  // moves it. Ordinary text, readable on request.
  const plate = html.slice(html.indexOf('id="skyReadout"'), html.indexOf('</div>', html.indexOf('id="skyReadout"')));
  assert.ok(!/aria-live|role="status"|aria-hidden/.test(plate),
    'neither a live region nor hidden from a screen reader');
});

test('the numbers come from the draw, so they are right in Auto Mode too', () => {
  // skyAim is the hand's aim and the phone never writes it. drawSkyView
  // reports where it actually pointed, in either mode, and that is what is
  // shown -- otherwise Auto Mode would show where the hand last left the view.
  const draw = appJs.slice(appJs.indexOf('function drawLiveSky('), appJs.indexOf('function showReadout('));
  assert.match(draw, /const painted = drawSkyView\(/, 'the return value must be kept');
  assert.match(draw, /showReadout\(painted\.aimedAz, painted\.aimedAlt\);/,
    'and it must feed the plate');
  const show = appJs.slice(appJs.indexOf('function showReadout('), appJs.indexOf('\n}', appJs.indexOf('function showReadout(')));
  assert.match(show, /Math\.round/, 'whole degrees: a flickering decimal is worse than none');
  assert.match(show, /compassPoint\(/, 'with the compass point');
  assert.match(show, /el\.hidden = false;/, 'shown on the first paint');
});

test('the plate sits bottom centre windowed, matches the key, and lets a drag through', () => {
  const b = block('.sky-readout {');
  assert.match(b, /position: absolute/);
  assert.match(b, /left: 50%/);
  assert.match(b, /bottom: max\(0\.6rem, env\(safe-area-inset-bottom\)\)/, 'clear of the home bar');
  assert.match(b, /translateX\(-50%\)/);
  assert.match(b, /font-variant-numeric: tabular-nums/, 'a 9 becoming a 10 must not shift the plate');
  assert.match(b, /pointer-events: none/, 'a drag that starts on the numbers is a drag on the sky');
  // The key's own plate, so the two read as one family.
  const key = block('.sky-legend {');
  for (const prop of ['background: rgba(10, 14, 24, 0.72)', 'border-radius: 0.9rem']) {
    assert.ok(key.includes(prop) && b.includes(prop), `${prop} must match the key`);
  }
  assert.match(block("html[data-night='on'] .sky-readout {"), /color: var\(--ink\)/, 'red at night');
});

test('in full screen the plate sits above the arrow pad, and drops into its corner when the pad is hidden', () => {
  // Bottom centre was tried first: on a 375px phone the plate touched the
  // Down button, because the gap between the pad and the zoom column is
  // narrower than the numbers. Found by measuring the boxes in a browser.
  const full = block('.live-sky.full .sky-readout {');
  assert.match(full, /left: max\(0\.6rem, env\(safe-area-inset-left\)\)/, 'aligned with the pad');
  assert.match(full, /transform: none/);
  assert.match(full, /bottom: calc\(max\(0\.6rem, env\(safe-area-inset-bottom\)\) \+ 10\.9rem \+ 0\.6rem\)/,
    'three pad rows plus the gap every plate keeps');
  // The pad is three 3.4rem rows with two 0.35rem gaps: 10.9rem. If the pad
  // changes, this must change with it.
  const pad = block('.live-sky.full .full-pan:not([hidden]) {');
  assert.match(pad, /grid-template-columns: 3\.4rem 3\.4rem 3\.4rem/);
  assert.match(pad, /gap: 0\.35rem/);
  const auto = block('.live-sky.full:has(#fullPan[hidden]) .sky-readout {');
  assert.match(auto, /bottom: max\(0\.6rem, env\(safe-area-inset-bottom\)\)/,
    'with no pad there is nothing to sit above');
});

test('sixteen compass points, each owning 22.5 degrees centred on itself', () => {
  for (const [deg, want] of [[0, 'N'], [11, 'N'], [11.25, 'NNE'], [22.5, 'NNE'], [45, 'NE'],
    [90, 'E'], [112, 'ESE'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'],
    [315, 'NW'], [337.5, 'NNW'], [348.75, 'N'], [359, 'N'], [360, 'N'], [-90, 'W'], [450, 'E']]) {
    assert.equal(compassPoint(deg), want, `${deg} degrees`);
  }
});
