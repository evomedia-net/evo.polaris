// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createNorthAnchor, inAnchorBand, anchorSample, ANCHOR_BETA_MAX,
} from '../site/src/compass.js';
import { deviceBasis, vectorToAltAz } from '../site/src/skyview.js';
import { compassSummary } from '../site/src/words.js';

// THE IPHONE POINTED THE SKY THE WRONG WAY (#295). "the moon and any object
// we looked at was actually 180 degrees off axis on the iPhone in Safari and
// Chrome, but it worked fine on my Android". An iPhone's alpha is measured
// from wherever the phone faced when listening began; its compass arrives
// beside it as webkitCompassHeading, magnetic. These tests build a real
// orientation, derive what an iPhone would report for it, and check that the
// view points where the phone points.

const appJs = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const wrap = (d) => ((d % 360) + 360) % 360;
const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Where the back of the phone points, for a true (absolute) orientation. */
const aimed = (alpha, beta, gamma, decl = 0) => vectorToAltAz(deviceBasis(alpha, beta, gamma, decl).forward);

/**
 * What an iPhone reports for a phone whose true alpha is `alpha`, if it began
 * listening while facing `startAlpha`: alpha relative to that, and the compass
 * heading of the top edge. Past upright the top edge points behind you, so
 * that heading turns half way round -- the reading of Apple's docs this fix
 * must survive.
 */
function iphone(alpha, beta, gamma, startAlpha) {
  const topEdgeHeading = Math.cos(beta * Math.PI / 180) >= 0 ? wrap(360 - alpha) : wrap(180 - alpha);
  return { alpha: wrap(alpha - startAlpha), beta, gamma, heading: topEdgeHeading, accuracy: 10 };
}

test('the old way was off by however the phone faced at the start: 180 for someone facing south', () => {
  // Facing the Moon low in the south and tipped back to it: true alpha 180.
  const truth = aimed(180, 120, 0);
  assert.ok(off(truth.az, 180) < 0.5, `the phone itself points south (got ${truth.az})`);
  const r = iphone(180, 120, 0, 180);
  const old = aimed(r.alpha, r.beta, r.gamma);
  assert.ok(off(old.az, truth.az) > 179, `relative alpha drew the sky ${off(old.az, truth.az)} degrees round`);
});

test('anchored, the view points where the phone points, even tipped back past upright', () => {
  const anchor = createNorthAnchor();
  const start = 180;                                   // began facing south
  // Raised from the hand: inside the band, the compass and alpha agree.
  anchor.update(iphone(185, 45, 3, start));
  assert.equal(anchor.provisional, false);
  // Then up to the Moon, past upright, where the top-edge heading has turned.
  for (const [alpha, beta, gamma] of [[180, 120, 0], [200, 135, -8], [150, 100, 12]]) {
    const r = iphone(alpha, beta, gamma, start);
    const abs = anchor.update(r);
    const got = aimed(abs, beta, gamma);
    const want = aimed(alpha, beta, gamma);
    assert.ok(off(got.az, want.az) < 0.5 && Math.abs(got.alt - want.alt) < 0.5,
      `at beta ${beta}: drew az ${got.az.toFixed(1)}, phone points ${want.az.toFixed(1)}`);
  }
});

test('out-of-band readings never move a settled offset', () => {
  const anchor = createNorthAnchor();
  anchor.update(iphone(90, 50, 0, 30));
  const settled = anchor.offset;
  // The flipped top-edge heading past upright would pull it half way round.
  for (let i = 0; i < 50; i++) anchor.update(iphone(90, 130, 0, 30));
  assert.equal(anchor.offset, settled);
});

test('before the band has been reached, a reading stands in, marked provisional, and the band replaces it', () => {
  const anchor = createNorthAnchor();
  assert.equal(anchor.update({ alpha: 10, beta: 0, gamma: 0, heading: Number.NaN }), null,
    'nothing to go on yet');
  anchor.update(iphone(200, 140, 0, 60));
  assert.equal(anchor.provisional, true);
  anchor.update(iphone(200, 40, 0, 60));
  assert.equal(anchor.provisional, false);
  assert.ok(off(anchor.offset, 60) < 1e-9, `the true start was 60, offset ${anchor.offset}`);
});

test('an uncalibrated compass can stand in but never settle the offset', () => {
  const anchor = createNorthAnchor();
  anchor.update({ ...iphone(100, 40, 0, 0), accuracy: -1 });
  assert.equal(anchor.provisional, true);
});

test('a settled offset follows slow gyro drift without jumping on one sample', () => {
  const anchor = createNorthAnchor();
  anchor.update(iphone(0, 40, 0, 0));
  const one = anchor.update({ ...iphone(0, 40, 0, 0), heading: 20 }) ;
  assert.ok(off(wrap(360 - one), 0) < 4, 'one stray 20 degree sample moves it by a fraction');
  for (let i = 0; i < 60; i++) anchor.update({ ...iphone(0, 40, 0, 0), heading: 5 });
  assert.ok(off(wrap(360 - anchor.update({ ...iphone(0, 40, 0, 0), heading: 5 })), 5) < 0.5,
    'a steady new reading is followed');
});

test('the band is the tilt where every reading of the docs agrees', () => {
  assert.equal(inAnchorBand(45, 0), true);
  assert.equal(inAnchorBand(ANCHOR_BETA_MAX + 1, 0), false, 'upright and past is excluded');
  assert.equal(inAnchorBand(5, 0), false, 'flat is excluded: the back of the phone points at the ground');
  assert.equal(inAnchorBand(45, 40), false, 'rolled hard sideways is excluded');
  assert.equal(anchorSample(30, 300), 30, '360 - (30 + 30) = 300');
});

test('reset forgets the offset, because the phone restarts its reckoning', () => {
  const anchor = createNorthAnchor();
  anchor.update(iphone(0, 40, 0, 0));
  anchor.reset();
  assert.equal(anchor.offset, null);
  assert.equal(anchor.provisional, true);
});

test('app.js ties alpha to the compass on an iPhone and passes Android through', () => {
  const at = appJs.indexOf('function onOrientation(e)');
  const fn = appJs.slice(at, appJs.indexOf('\n}', at));
  assert.match(fn, /if \(typeof e\.webkitCompassHeading === 'number'\) \{\s*rawAlpha = northAnchor\.update\(/);
  assert.match(fn, /\} else \{\s*rawAlpha = e\.alpha;\s*\}/);
  // The heading is magnetic on both, so both get the declination.
  assert.match(fn, /const magnetic = \(360 - rawAlpha\) % 360;/);
  assert.doesNotMatch(fn, /\? e\.webkitCompassHeading\s+\/\/ already true north/,
    'the heading is not taken as-is on an iPhone any more');
  assert.doesNotMatch(fn, /e\.webkitCompassHeading != null \|\| !site/,
    'an iPhone must not skip the declination');
  const stop = appJs.slice(appJs.indexOf('function stopCompass()'), appJs.indexOf('// IOS WILL ONLY ASK'));
  assert.match(stop, /northAnchor\.reset\(\);/);
});

test('an iPhone is told its compass works, and how to settle it when it is not yet sure', () => {
  const iphoneSensor = (provisional) => ({ event: 'deviceorientation', absolute: false, anchor: { offset: 30, provisional } });
  assert.equal(compassSummary(iphoneSensor(false), 18.2), 'Compass working — the phone is pointing 18° NNE.');
  assert.match(compassSummary(iphoneSensor(true), 18.2), /hold it as if reading it for a moment\.$/);
  assert.match(compassSummary({ event: 'deviceorientation', absolute: false }, 18), /did not offer a compass/,
    'a relative alpha with no compass beside it is still reported as such');
});
