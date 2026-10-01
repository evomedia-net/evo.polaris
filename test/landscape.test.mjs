import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// FULL SCREEN ON A PHONE ON ITS SIDE.
//
// Every full-screen control is stacked for a phone held upright. Turned on
// its side the same phone is 390px tall, and measured at 844x390 the stacks
// ran off it (#167): at the default text size the key covered Zoom in, Hide
// the horizon and Hide the constellation art; at the second size the right
// column climbed 59px above the top edge, so "Hide the constellation art"
// could not be reached at all; at the third the Track column sat on "Look up".
//
// With the landscape block below, a rectangle-intersection sweep of every
// button, the key and the Az/Alt plate found nothing overlapping and nothing
// off screen at the first three sizes, and nothing at 1280x800 or in portrait.
// The top two sizes on a phone on its side are still crowded -- the key sits
// over the pad -- and belong with #147, which is the same crowding upright.
//
// This file pins the arrangement; the sweep is what proved it, and is the
// thing to re-run when any of these numbers move.

const css = readFileSync(fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');
const at = css.indexOf('@media (orientation: landscape) {', css.indexOf('LANDSCAPE: SIDE BY SIDE'));
const block = css.slice(at, css.indexOf('\n}\n', at));

test('there is a landscape arrangement for full screen', () => {
  assert.ok(at > 0, 'no landscape block after its comment');
});

test('it comes after every rule it overrides, or it loses', () => {
  // The first draft sat above these and changed nothing: equal weight, so
  // source order decides, and the later portrait rules won.
  for (const rule of ['.live-sky.full .full-zoom {', '.live-sky.full .full-targets {',
    '.live-sky.full .full-pan:not([hidden]) {', '.live-sky.full .sky-readout {',
    '.live-sky.full .sky-legend {']) {
    const i = css.indexOf(rule);
    assert.ok(i > 0, `${rule} is gone`);
    assert.ok(i < at, `${rule} comes after the landscape block and beats it`);
  }
});

test('the right-hand column goes two by two, and the key steps beside it', () => {
  assert.match(block, /\.live-sky\.full \.full-zoom \{\s*display: grid;\s*grid-template-columns: repeat\(2, calc\(4 \* var\(--ctl\)\)\);/);
  // Two 4-unit columns and their 0.6 gap is 8.6 units of the controls' own
  // size (#147), plus the key's own gap, which is a plate's and so in rem.
  assert.match(block, /\.live-sky\.full \.sky-legend \{\s*right: calc\(max\(0\.6rem, env\(safe-area-inset-right\)\) \+ 8\.6 \* var\(--ctl\) \+ 0\.6rem\);/);
});

test('the pad and the Az/Alt plate move beside the Track column', () => {
  assert.match(block, /width: 9\.5rem;/);
  assert.match(block, /max-height: calc\(100% - 1\.2rem\);/,
    'nothing is under the Track column now, so it gets the height');
  assert.match(block, /\.live-sky\.full \.full-pan:not\(\[hidden\]\),\s*\.live-sky\.full \.sky-readout \{\s*left: calc\(max\(0\.6rem, env\(safe-area-inset-left\)\) \+ 9\.5rem \+ 0\.6rem\);/);
  // All three Track-column caps are overridden, or whichever state the pad
  // and the draw-speed row are in would put the portrait cap back.
  assert.match(block, /\.live-sky\.full:has\(#rdCostRow:not\(\[hidden\]\)\) \.full-targets/);
  assert.match(block, /\.live-sky\.full:has\(#fullPan\[hidden\]\) \.full-targets/);
});

test('no button changes size to make it fit', () => {
  // "We do not want to change the button size." Room comes from the width.
  assert.ok(!/(?:^|[\s;{])(?:height|font-size):/.test(block), 'a height or font size in the landscape block');
  assert.ok(!/\.map-(?:zoom|pan)-btn/.test(block), 'the landscape block restyles a button');
});
