// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// NOTHING ON THE FULL-SCREEN OVERLAY COVERS ANYTHING ELSE (#179), AND NO
// TRACK LABEL LOSES ITS LAST LETTERS (#180), at any text size, on any phone.
//
// Checked in a browser before these were written: a sweep of nine phones,
// five upright and four on their side, at all five text sizes, in the default
// mode and in WCAG Mode -- rectangle intersections between every control,
// anything off the screen, and every label's scroll width. Before: the key
// on Art and Horizon on short phones, on the pad and the Az/Alt plate on its
// side, and the Track column scrolling sideways from 1.15. After: none.
// These hold the rules that did it.

const css = readFileSync(fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
const block = (sel) => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `${sel} is gone`);
  return css.slice(i, css.indexOf('\n}', i));
};

test('upright, the right-hand buttons go two by two, lifted above a pad they would not clear', () => {
  const b = block('.live-sky.full .full-zoom {');
  assert.match(b, /display: grid;\s*grid-template-columns: repeat\(2, calc\(4 \* var\(--ctl\)\)\);/);
  // The lift is a step: 0 while the grid fits beside the 10.9-unit pad
  // (19.5 units and three 0.6rem gaps across), 6.9 units -- to the pad's top
  // -- when it does not. clamp() with a large factor is CSS's only if.
  assert.match(b, /--zoom-lift: clamp\(0px, \(1\.8rem \+ 19\.5 \* var\(--ctl\) - 100vw\) \* 1000, 6\.9 \* var\(--ctl\)\);/);
  assert.match(b, /bottom: calc\(max\(0\.6rem, env\(safe-area-inset-bottom\)\) \+ 4\.6 \* var\(--ctl\) \+ var\(--zoom-lift\)\);/);
});

test('the key stops above the buttons under it, and scrolls rather than covers', () => {
  const b = block('.live-sky.full .sky-legend {');
  // 13.2 units is the exit (4.6) and the grid's two rows (8.6); the same lift
  // step follows, so the key and the grid move together.
  assert.match(b, /max-height: calc\(100% - max\(0\.6rem, env\(safe-area-inset-top\)\)\s*- max\(0\.6rem, env\(safe-area-inset-bottom\)\) - 13\.2 \* var\(--ctl\)\s*- clamp\(0px, \(1\.8rem \+ 19\.5 \* var\(--ctl\) - 100vw\) \* 1000, 6\.9 \* var\(--ctl\)\) - 0\.6rem\);/);
  assert.match(b, /overflow-y: auto;/, 'the smallest phones at the largest text scroll it');
  assert.match(b, /overflow-x: hidden;/, 'never sideways');
  // It still takes its own taps (#278), or a scroll on it would move the sky.
  assert.match(block('.sky-legend {'), /pointer-events: auto;/);
  // Capped, a row that would once have spilled past the plate is clipped --
  // so the word drops under its swatch instead.
  assert.match(css, /\.live-sky\.full \.leg-row \{ flex-wrap: wrap; \}/);
});

test('on its side the key keeps right of the pad, and goes above the grid when squeezed', () => {
  const at = css.indexOf('@media (orientation: landscape) {');
  const land = css.slice(at, css.indexOf('\n}\n', at));
  const key = land.slice(land.indexOf('.live-sky.full .sky-legend {'), land.indexOf('\n  }', land.indexOf('.live-sky.full .sky-legend {')));
  // The gap between the pad's stack and the grid: 9.5rem of Track column,
  // the 10.9-unit pad, the 8.6-unit grid, four gaps and the two insets.
  assert.match(key, /--key-gap: calc\(100vw - 12\.5rem - 19\.5 \* var\(--ctl\)\);/);
  // Under 10rem of gap the same step moves it right, widens it to the room
  // over the grid, and stops it above the grid's top.
  for (const prop of ['right', 'max-width', 'max-height']) {
    assert.match(key, new RegExp(`${prop}: calc\\([^;]*clamp\\(0px, \\(10rem - var\\(--key-gap\\)\\) \\* 1000,`),
      `${prop} does not take the squeeze step`);
  }
});

test('the Track labels wrap in every mode, and "TRACK" stays one word', () => {
  const b = block('.live-sky.full .tgt-btn {');
  assert.match(b, /white-space: normal;/);
  assert.match(b, /overflow-wrap: anywhere;/);
  assert.match(html, />Constel&shy;lations<\/button>/);
  // The heading is a Track button too, and broke as "TRA / CK" at 1.6. Four
  // classes, so it outranks the rule above; the chevron drops instead.
  const h = block('.live-sky.full .tgt-btn.track-head {');
  assert.match(h, /white-space: nowrap;/);
  assert.match(h, /overflow-wrap: normal;/);
  assert.match(h, /flex-wrap: wrap;/);
});
