import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE TARGET RING IS LOCKED TO THE SCREEN, AND THIS HAS BEEN FLIPPED TWICE.
//
// The ring marks what you are aligning to -- Polaris in the north, sigma
// Octantis in the south. It is h/14 pixels at every zoom.
//
// It was briefly an ANGULAR size instead: a fixed 3.5 degrees of sky, put
// through the same focal length as the stars, on the reading that "it should
// not scale up when zooming out" meant it should hold its size against the
// constellations. That made the ring grow and shrink as the field changed,
// which is the thing this test exists to stop coming back.
//
// The reasoning, so nobody re-derives it a third time: the ring is a RETICLE,
// not a measurement. It says "your target is here". A marker that changes size
// while you zoom is a marker you have to re-read at every zoom level, and on a
// phone held up in the dark that is a real cost. The accepted trade is that at
// the widest field the sky shrinks under a ring that does not, so the ring
// covers more sky than it used to. If that ever needs softening, clamp it --
// do not make it angular again.
//
// Verified in a browser at the time of the fix: radius 53px at the tightest
// field, 53px at mid, 53px at the widest, with the canvas 743px tall (743/14).

const skydraw = readFileSync(
  fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');

/** The block that draws the target ring. */
const ringBlock = skydraw.slice(
  skydraw.indexOf('// The target:'),
  skydraw.indexOf('// The ISS,'));

test('the ring radius is a fixed fraction of the canvas', () => {
  assert.notEqual(ringBlock.length, 0, 'the target-ring block has moved');
  assert.match(ringBlock, /const r = h \/ 14;/,
    'the ring radius must be h/14 — a constant number of pixels');
});

test('the ring radius does not depend on the zoom', () => {
  // `focal` is the only thing in this drawing code that carries the field of
  // view, so the radius must not be computed from it.
  const line = ringBlock.split('\n').find((l) => /const r =/.test(l));
  assert.ok(line, 'no radius assignment found in the ring block');
  assert.ok(!line.includes('focal'),
    `the radius must not be derived from the focal length: ${line.trim()}`);
  assert.ok(!/RING_DEG|Math\.tan/.test(ringBlock),
    'the angular ring (RING_DEG / Math.tan) is back — see the note above');
});

test('the crosshair ticks follow the ring', () => {
  // They are drawn at multiples of r, so they are screen-locked for free.
  // Stated as a test because drawing them from `focal` would reintroduce the
  // bug in a place nobody would look for it.
  assert.match(ringBlock, /r \* 1\.7/, 'the crosshair ticks must scale off r');
  assert.match(ringBlock, /r \* 1\.15/, 'the crosshair ticks must scale off r');
});
