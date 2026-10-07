// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCALE_MAX } from '../site/src/textsize.js';

// NOTHING ON THE FULL-SCREEN OVERLAY IS DRAWN OVER ANYTHING ELSE (#147).
//
// At the top two text sizes on a 375x812 phone, the key covered the Track
// column and the arrow pad covered Zoom out. Everything was sized in rem, and
// rem is the text setting, so the pad and the zoom column kept growing after
// the phone had run out of width.
//
// The fix is a unit of their own, --ctl: the text size until the row would
// not fit, never less than the normal size. The key stops at the Track
// column's edge, and its credits wrap rather than push into it.
//
// The proof that it fits is a browser sweep -- every control's box, at every
// text size, upright and on its side, on phones 320 to 412 wide -- which is in
// the PR. What these hold is that the numbers the cap is built from ARE the
// numbers the controls are built from, so a bigger button or one more of them
// fails here instead of on a phone.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const css = read('../site/src/style.css');
const html = read('../site/index.html');

const block = (sel) => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `${sel} is gone from style.css`);
  return css.slice(i, css.indexOf('}', i));
};
const units = (b, prop) => {
  const m = b.match(new RegExp(`\\b${prop}:\\s*calc\\(([\\d.]+) \\* var\\(--ctl(?:, 1rem)?\\)\\)`));
  assert.ok(m, `no ${prop} in --ctl`);
  return Number(m[1]);
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

const CTL = css.match(
  /--ctl: max\(var\(--base\), min\(1rem, \(100vw - ([\d.]+)rem\) \/ ([\d.]+), \(100svh - ([\d.]+)rem\) \/ ([\d.]+)\)\);/);
const BASE = Number(css.match(/--base:\s*(\d+)px;/)[1]);
const GAP = 0.6;                          // the gap every plate and control keeps

const padBtn = units(block('.live-sky.full .map-pan-btn {'), 'width');
const padGap = units(block('.live-sky.full .full-pan:not([hidden]) {'), 'gap');
const padWidth = 3 * padBtn + 2 * padGap;
const zoomBtn = units(block('.live-sky.full .map-zoom-btn {'), 'height');
const zoomGap = units(block('.live-sky.full .full-zoom {'), 'gap');
const exitBtn = units(block('.map-full {'), 'height');
const zoomCount = (() => {
  const i = html.indexOf('<div class="full-zoom"');
  assert.ok(i > 0, 'the zoom column is gone from index.html');
  return (html.slice(i, html.indexOf('</div>', i)).match(/<button /g) || []).length;
})();

test('the controls have a unit of their own, floored at the normal size and capped at the text size', () => {
  assert.ok(CTL, '--ctl is not max(var(--base), min(1rem, <width>, <height>))');
  assert.match(block('.live-sky.full {'), /--ctl:/, 'it is set on the full-screen overlay');
});

test('the width it is capped at is the pad and the column side by side', () => {
  // Pad on the left, column on the right, three gaps: its inset, the space
  // between, the column's inset.
  const [, insets, perUnit] = CTL;
  assert.ok(near(Number(perUnit), padWidth + zoomBtn),
    `cap divides by ${perUnit}; the pad (${padWidth}) and the column (${zoomBtn}) are ${padWidth + zoomBtn}`);
  assert.ok(near(Number(insets), 3 * GAP), `${insets}rem of gaps; three are ${3 * GAP}`);
});

test('the height it is capped at is the column under the key', () => {
  // Down the right edge: the key, then the column -- its buttons and the way
  // out, with a gap between each.
  const [, , , keyAndGaps, perUnit] = CTL;
  const column = zoomCount * zoomBtn + exitBtn + zoomCount * zoomGap;
  assert.ok(near(Number(perUnit), column), `cap divides by ${perUnit}; the column is ${column}`);
  // The exit sits under the column by the same gap the column keeps.
  assert.match(block('.live-sky.full .full-zoom {'),
    new RegExp(`\\+ ${exitBtn + zoomGap} \\* var\\(--ctl\\)\\);`));
  // 12rem is the tallest the key measured: all six rows, credits wrapped, at
  // 1.45 and 1.6 on a 375px phone (11.9rem). A seventh row makes that stale.
  assert.ok(near(Number(keyAndGaps), 12 + 3 * GAP), `${keyAndGaps}rem for the key and its gaps`);
  const rows = (html.slice(html.indexOf('id="skyLegend"'), html.indexOf('</ul>', html.indexOf('id="skyLegend"')))
    .match(/<li /g) || []).length;
  assert.equal(rows, 6, 'the key has a new row: measure its height again and move the 12rem');
});

test('at the floor, the row still fits the narrowest phone at the largest text', () => {
  // When the cap would go under the normal size it stops there, so the gaps
  // (rem, which keep growing) and the controls (at the normal size) must
  // still fit across a 320px screen.
  const [, insets] = CTL;
  const px = (padWidth + zoomBtn) * BASE + Number(insets) * BASE * SCALE_MAX;
  assert.ok(px <= 320, `${px.toFixed(1)}px of controls and gaps across a 320px screen`);
});

test('every full-screen control is sized in the unit, not in rem', () => {
  for (const sel of ['.live-sky.full .map-zoom-btn {', '.live-sky.full .map-pan-btn {',
    '.live-sky.full .full-pan:not([hidden]) {', '.live-sky.full .full-zoom {', '.map-full {']) {
    // .map-full is the windowed "Full screen" button too, where there is no
    // --ctl and its fallback, 1rem, is the size it always had.
    const b = block(sel).replaceAll('var(--ctl, 1rem)', 'var(--ctl)');
    for (const prop of ['width', 'height', 'font-size', 'gap', 'grid-template-columns']) {
      assert.ok(!new RegExp(`(^|[\\s;{])${prop}:[^;]*\\d(\\.\\d+)?rem`).test(b),
        `${sel} still sets ${prop} in rem, which grows with the text past the phone`);
    }
  }
  // The words inside the buttons are capped with them, or they would outgrow
  // the faces they are written on.
  for (const sel of ['.live-sky.full .map-zoom-btn.tagged .btn-glyph', '.live-sky.full .map-pan-btn.tagged .btn-glyph',
    '.live-sky.full .map-pan-btn.tagged .btn-tag', '.live-sky.full .map-full.tagged .btn-glyph']) {
    assert.match(block(sel), /font-size: calc\([\d.]+ \* var\(--ctl\)\)/, `${sel} is not in --ctl`);
  }
  assert.match(css, /\.live-sky\.full \.map-zoom-btn\.tagged \.btn-tag,\s*\.live-sky\.full \.map-full\.tagged \.btn-tag \{ font-size: calc\(0\.56 \* var\(--ctl\)\); \}/);
});

test('the key stops at the Track column, and its credits wrap rather than reach it', () => {
  const track = Number(block('.live-sky.full .full-targets {').match(/max-width:\s*([\d.]+)%/)[1]);
  const key = block('.live-sky.full .sky-legend {').match(/max-width: calc\(([\d.]+)% - ([\d.]+)rem\);/);
  assert.ok(key, 'the key has no max-width');
  assert.equal(Number(key[1]), 100 - track, `the key takes ${key[1]}% beside a ${track}% column`);
  assert.ok(near(Number(key[2]), 3 * GAP), 'less the column\'s inset, the gap, and its own inset');
  assert.match(css, /\.live-sky\.full \.leg-credit \{ white-space: normal; \}/, 'the credits must wrap on the plate');
});
