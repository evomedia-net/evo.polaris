// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCALE_MAX } from '../site/src/textsize.js';

// THE TARGET COLUMN IS CAPPED AT THE SCREEN, NOT ITS BUTTONS AT A SIZE.
//
// On a 375x812 phone in full screen, the column of target buttons top-left
// reached down to the top of "Look up" bottom-left: a label overlapping a
// control (#74). The buttons could have been made smaller. The answer was
// explicit -- "We do not want to change the button size. For older phones,
// I would cap the screen." -- so the column is capped above the pad, and
// scrolls within itself when it is too tall. Every button keeps its size.
//
// The cap is arithmetic on the pad's own numbers, and this test does the
// same arithmetic from the same stylesheet: a taller pad, or a bigger pad
// button, fails here instead of quietly overlapping on a phone nobody in
// the room owns.
//
// TWO UNITS SINCE #147. The pad is sized in --ctl, the controls' own unit,
// and the plates and gaps around it in rem, so each cap is
// `100% - <pad> * var(--ctl) - <the rest>rem` and the two halves are checked
// separately.

const css = readFileSync(
  fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');

const block = (sel) => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `${sel} is gone from style.css`);
  return css.slice(i, css.indexOf('}', i));
};
const rem = (b, prop) => {
  const m = b.match(new RegExp(`\\b${prop}:\\s*([\\d.]+)rem`));
  assert.ok(m, `no ${prop} in rem`);
  return Number(m[1]);
};
const units = (b, prop) => {
  const m = b.match(new RegExp(`\\b${prop}:\\s*calc\\(([\\d.]+) \\* var\\(--ctl\\)\\)`));
  assert.ok(m, `no ${prop} in --ctl`);
  return Number(m[1]);
};

const CAP = /max-height:\s*calc\(100% - ([\d.]+) \* var\(--ctl\) - ([\d.]+)rem\)/;

test('the column is capped at the screen and scrolls, rather than shrinking anything', () => {
  const col = block('.live-sky.full .full-targets {');
  assert.ok(CAP.test(col), 'the column must be capped at the screen');
  assert.match(col, /overflow-y:\s*auto/, 'too tall means it scrolls within itself');
  // No button size rule in this block: the cap is the whole fix.
  assert.ok(!/min-height|height:\s*[\d.]+rem/.test(col), 'the column must not size its buttons');
});

const capOf = (sel) => {
  const m = block(sel).match(CAP);
  assert.ok(m, `${sel} has no cap`);
  return { pad: Number(m[1]), rest: Number(m[2]) };
};
const inset = 0.6;

/** The pad: three rows of pad button and two gaps, in --ctl. */
function padHeight() {
  const padBtn = units(block('.live-sky.full .map-pan-btn {'), 'height');
  const gap = units(block('.live-sky.full .full-pan:not([hidden]) {'), 'gap');
  return 3 * padBtn + 2 * gap;
}

/** The Az/Alt plate, `rows` rows tall, in rem. */
function plateHeight(rows) {
  const p = block('.sky-readout {');
  const font = rem(p, 'font-size');
  const line = Number(p.match(/line-height:\s*([\d.]+);/)[1]);
  const gap = rem(p, 'gap');
  const pad = Number(p.match(/padding:\s*([\d.]+)rem/)[1]);
  // Two 1px borders, as rem at the default 16px.
  return rows * font * line + (rows - 1) * gap + 2 * pad + 2 / 16;
}

test('with the pad showing, the cap clears the pad AND the Az/Alt plate above it', () => {
  // The plate sits on top of the pad in full screen, so the column has to
  // stop above both. Before the plate was counted, a column with one more
  // button -- the "Skip what is down" switch -- covered the numbers.
  const plate = block('.live-sky.full .sky-readout {');
  assert.match(plate, /bottom: calc\(max\(0\.6rem, env\(safe-area-inset-bottom\)\) \+ 10\.9 \* var\(--ctl\) \+ 0\.6rem\);/,
    'the plate sits on the pad, a gap above it');
  const cap = capOf('.live-sky.full .full-targets {');
  assert.ok(Math.abs(cap.pad - padHeight()) < 1e-9, `cap leaves ${cap.pad} for a ${padHeight()} pad`);
  const needed = inset + 0.6 + plateHeight(2) + 0.6 + inset;
  assert.ok(cap.rest >= needed - 1e-9,
    `cap of ${cap.rest}rem lets the column reach the plate; it needs at least ${needed.toFixed(2)}rem`);
  // And not absurdly more: a cap that ate half the screen would hide targets
  // on phones that have room for them.
  assert.ok(cap.rest <= needed + 1, `cap of ${cap.rest}rem is ${(cap.rest - needed).toFixed(2)}rem more than it needs`);
});

test('with the draw-speed row showing, the plate is a row taller and so is the cap', () => {
  const cap = capOf('.live-sky.full:has(#rdCostRow:not([hidden])) .full-targets {');
  assert.ok(Math.abs(cap.pad - padHeight()) < 1e-9);
  const needed = inset + 0.6 + plateHeight(3) + 0.6 + inset;
  assert.ok(cap.rest >= needed - 1e-9, `cap of ${cap.rest}rem; it needs at least ${needed.toFixed(2)}rem`);
  assert.ok(cap.rest <= needed + 1, `cap of ${cap.rest}rem is ${(cap.rest - needed).toFixed(2)}rem more than it needs`);
});

test('in Auto Mode the pad is hidden, the plate is in the corner, and the column gets its room back', () => {
  assert.match(block('.live-sky.full:has(#fullPan[hidden]) .sky-readout {'),
    /bottom: max\(0\.6rem, env\(safe-area-inset-bottom\)\);/, 'the plate drops into the corner');
  const cap = capOf('.live-sky.full:has(#fullPan[hidden]) .full-targets {');
  // It must still clear the pad's space (the pad comes back the moment an
  // arrow is pressed) and the plate, now in the corner.
  assert.ok(cap.pad >= padHeight() - 1e-9, `cap leaves ${cap.pad} for a ${padHeight()} pad`);
  assert.ok(cap.rest >= inset + inset + 0.6 - 1e-9, `cap of ${cap.rest}rem`);
  // The plate is in rem and the pad's space in --ctl, which can be as small
  // as the normal-size rem: at the largest text setting that is
  // 1/SCALE_MAX of the current one. The cap has to clear the plate even then.
  const worst = cap.pad / SCALE_MAX + cap.rest;
  assert.ok(worst >= inset + plateHeight(3) + 0.6 + inset - 1e-9,
    `at the largest text the cap is ${worst.toFixed(2)}rem, under the plate's ${plateHeight(3).toFixed(2)}rem`);
  // Last of the three, so it wins over the draw-speed rule at equal weight.
  assert.ok(css.indexOf('.live-sky.full:has(#fullPan[hidden]) .full-targets {')
    > css.indexOf('.live-sky.full:has(#rdCostRow:not([hidden])) .full-targets {'));
});

test('the pad buttons themselves are untouched', () => {
  const b = block('.live-sky.full .map-pan-btn {');
  assert.equal(units(b, 'width'), 3.4);
  assert.equal(units(b, 'height'), 3.4);
});
