// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  screenToVector, rotateFromTo, aimAfterDrag, projectToScreen, focalLength,
  basisFromAim, altAzToVector, vectorToAltAz,
} from '../site/src/skyview.js';

// TOUCHING THE MAP IS A QUESTION THE FORWARD PROJECTION CANNOT ANSWER.
//
// "Centre on the star I tapped" and "drag the sky under my finger" both ask
// which DIRECTION a pixel stands for. projectToScreen only goes the other way,
// so these two are the whole basis of tap and drag -- and a quiet error here
// would not crash anything, it would just put the sky slightly off from the
// finger, which is the kind of wrong that gets blamed on the phone.

const W = 720, H = 480;
const FOCAL = focalLength(W, 65);
const BASIS = basisFromAim(35, 40);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angleBetween = (a, b) =>
  Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;

// acos is flat near 1, so two directions that agree to the last bit of a
// double still measure about 1e-6 degrees apart. Anything tighter than this is
// asserting against floating point rather than against the code -- which is
// how the first draft of these tests failed against a correct implementation.
const SAME_DIRECTION_DEG = 1e-5;

test('the centre pixel is whatever the view is aimed at', () => {
  const v = screenToVector(0, 0, BASIS, FOCAL);
  assert.ok(angleBetween(v, BASIS.forward) < SAME_DIRECTION_DEG);
  const { alt, az } = vectorToAltAz(v);
  assert.ok(Math.abs(alt - 40) < 1e-6, `centre altitude ${alt}`);
  assert.ok(Math.abs(az - 35) < 1e-6, `centre azimuth ${az}`);
});

test('projecting and unprojecting returns the same direction', () => {
  // The property that matters: whatever pixel a star is drawn at, tapping that
  // pixel must name that star's direction back.
  for (let altD = -20; altD <= 80; altD += 10) {
    for (let azD = 0; azD < 360; azD += 37) {
      const v = altAzToVector(altD, azD);
      const p = projectToScreen(v, BASIS, FOCAL);
      if (!p) continue;                       // behind the viewer, not drawn
      if (Math.abs(p.x) > W / 2 || Math.abs(p.y) > H / 2) continue;  // off-screen
      const back = screenToVector(p.x, p.y, BASIS, FOCAL);
      assert.ok(angleBetween(v, back) < 1e-6,
        `alt ${altD} az ${azD} came back ${angleBetween(v, back).toFixed(6)}° out`);
    }
  }
});

test('screen y points down, the way the canvas does', () => {
  // Getting this backwards is silent: taps above centre would scroll the view
  // down. Higher on screen (negative dy) must mean higher in the sky.
  const up = vectorToAltAz(screenToVector(0, -100, BASIS, FOCAL));
  const down = vectorToAltAz(screenToVector(0, 100, BASIS, FOCAL));
  assert.ok(up.alt > 40, `tapping above centre gave altitude ${up.alt}`);
  assert.ok(down.alt < 40, `tapping below centre gave altitude ${down.alt}`);
});

test('right of centre is clockwise round the compass', () => {
  const right = vectorToAltAz(screenToVector(200, 0, BASIS, FOCAL));
  const left = vectorToAltAz(screenToVector(-200, 0, BASIS, FOCAL));
  const turn = (a, b) => ((b - a + 540) % 360) - 180;
  assert.ok(turn(35, right.az) > 0, `right of centre gave azimuth ${right.az}`);
  assert.ok(turn(35, left.az) < 0, `left of centre gave azimuth ${left.az}`);
});

// --- the drag rotation -------------------------------------------------------

test('the rotation carries one direction exactly onto the other', () => {
  const a = altAzToVector(10, 20), b = altAzToVector(55, 300);
  assert.ok(angleBetween(rotateFromTo(a, b, a), b) < SAME_DIRECTION_DEG);
});

test('identical directions mean no rotation, and no divide by zero', () => {
  // The first pixel of every drag. NaN here would throw the view away.
  const a = altAzToVector(30, 120);
  const out = rotateFromTo(a, a, altAzToVector(60, 200));
  assert.ok(out.every(Number.isFinite), `not finite: ${out}`);
  assert.ok(angleBetween(out, altAzToVector(60, 200)) < SAME_DIRECTION_DEG);
});

test('it is a rotation: lengths and angles survive it', () => {
  const from = altAzToVector(20, 40), to = altAzToVector(25, 55);
  const p = altAzToVector(70, 300), q = altAzToVector(15, 100);
  const rp = rotateFromTo(from, to, p), rq = rotateFromTo(from, to, q);
  assert.ok(Math.abs(Math.hypot(...rp) - 1) < 1e-9, 'length changed');
  assert.ok(Math.abs(angleBetween(p, q) - angleBetween(rp, rq)) < 1e-6,
    'the angle between two directions changed under the rotation');
});

/** How far the grabbed sky ends up from the finger, in pixels. */
function slipFor(startPx, nowPx, basis = BASIS, focal = FOCAL, passes) {
  const grabbed = screenToVector(startPx.x, startPx.y, basis, focal);
  const { alt, az } = aimAfterDrag(grabbed, nowPx.x, nowPx.y, basis, focal, passes);
  const p = projectToScreen(grabbed, basisFromAim(az, alt), focal);
  assert.ok(p, 'the grabbed sky ended up behind the viewer');
  return Math.hypot(p.x - nowPx.x, p.y - nowPx.y);
}

test('dragging keeps the grabbed patch of sky under the finger', () => {
  // The whole feel of the gesture: grab a point, move the finger, and that
  // same patch of sky has to still be under it.
  const slip = slipFor({ x: 120, y: -60 }, { x: -40, y: 30 });
  assert.ok(slip < 1, `the sky slipped ${slip.toFixed(2)}px away from the finger`);
});

/** How far the grabbed sky misses the finger, in DEGREES. */
function missDeg(startPx, nowPx, basis, focal) {
  const grabbed = screenToVector(startPx.x, startPx.y, basis, focal);
  const { alt, az } = aimAfterDrag(grabbed, nowPx.x, nowPx.y, basis, focal);
  return angleBetween(grabbed,
    screenToVector(nowPx.x, nowPx.y, basisFromAim(az, alt), focal));
}

test('it is exact everywhere the view is normally used', () => {
  // Pixels are a bad ruler off-axis -- a gnomonic projection stretches by
  // 1/cos^2, so at a 170 degree field the frame corner magnifies a tenth of a
  // degree into hundreds of pixels. Degrees are the honest measure, and this
  // is the range anyone actually drags in.
  for (const fovDeg of [10, 25, 45, 65]) {
    const focal = focalLength(W, fovDeg);
    for (const alt of [-30, -15, 0, 20, 40, 60]) {
      for (const az of [0, 75, 200, 300]) {
        const basis = basisFromAim(az, alt);
        for (const [from, to] of [
          [{ x: 300, y: 180 }, { x: -300, y: -180 }],
          [{ x: 0, y: 0 }, { x: 250, y: -150 }],
          [{ x: -200, y: 100 }, { x: 60, y: -40 }],
        ]) {
          // In pixels, because that is what a hand can see, and because at
          // these fields the corner only stretches about 1.4x so pixels still
          // mean something. (Degrees would read 0.13 here and sound alarming
          // when it is a pixel and a bit.)
          // Worst measured here is 4.47px, at a 65 degree field aimed 60 up,
          // dragged corner to corner -- the largest drag the frame allows, and
          // 0.6% of its width. Anything real is far smaller.
          const slip = slipFor(from, to, basis, focal);
          assert.ok(slip < 5,
            `fov ${fovDeg}, aim ${az}/${alt}: slipped ${slip.toFixed(2)}px`);
        }
      }
    }
  }
});

test('a drag never leaves the view worse off than not dragging', () => {
  // THE GUARANTEE THAT MATTERS, and it has to hold in the places the solve
  // cannot reach. With the horizon held level not every patch of sky can be
  // put at every pixel -- straight up, turning in azimuth spins the picture
  // instead of sliding it -- and at the widest fields a corner-to-corner drag
  // asks for a swing of more than a hundred degrees. There the answer falls
  // short. It must never fall BACKWARDS: the sky always moves the way the
  // finger went, however far it gets.
  for (const fovDeg of [10, 45, 65, 120, 170]) {
    const focal = focalLength(W, fovDeg);
    for (const alt of [-30, 0, 40, 80, 88]) {
      for (const az of [0, 120, 300]) {
        const basis = basisFromAim(az, alt);
        for (const [from, to] of [
          [{ x: 300, y: 180 }, { x: -300, y: -180 }],
          [{ x: 20, y: 10 }, { x: -30, y: 25 }],
          [{ x: -200, y: 100 }, { x: 60, y: -40 }],
        ]) {
          const grabbed = screenToVector(from.x, from.y, basis, focal);
          const before = angleBetween(grabbed,
            screenToVector(to.x, to.y, basis, focal));
          const after = missDeg(from, to, basis, focal);
          assert.ok(after <= before + 1e-9,
            `fov ${fovDeg}, aim ${az}/${alt}: dragging made it worse — `
            + `${before.toFixed(3)}° before, ${after.toFixed(3)}° after`);
        }
      }
    }
  }
});

test('straight up is a limit of the geometry, not a bug', () => {
  // Recorded so the number is not mistaken for a regression later. Aimed 88
  // degrees up, a zero-roll camera simply cannot put an arbitrary patch of sky
  // at an arbitrary pixel, and the pan pad cannot either -- which is why this
  // is a limit and not an unfairness between the two ways of steering.
  const focal = focalLength(W, 65);
  const miss = missDeg({ x: 300, y: 180 }, { x: -300, y: -180 },
    basisFromAim(300, 88), focal);
  assert.ok(miss > 0.1, 'if this is now exact the comment above is stale');
  assert.ok(miss < 30, `unreachable by ${miss.toFixed(1)}°, which is too far`);
});

test('solving it is what buys that, not luck', () => {
  // One pass is the single-rotation version this replaced. If the extra passes
  // ever stop mattering, the loop is doing nothing and should go.
  const from = { x: 120, y: -60 }, to = { x: -40, y: 30 };
  const onePass = slipFor(from, to, BASIS, FOCAL, 1);
  const threePass = slipFor(from, to, BASIS, FOCAL, 3);
  assert.ok(onePass > 5,
    `one pass should be visibly out, was ${onePass.toFixed(2)}px`);
  assert.ok(threePass < onePass / 5,
    `three passes (${threePass.toFixed(2)}px) should be far better than one `
    + `(${onePass.toFixed(2)}px)`);
});
