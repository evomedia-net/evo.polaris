import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clampAim } from '../site/src/skyview.js';

// BEING SENT SOMEWHERE IS NOT WANDERING.
//
// "when clicking ISS it would jump to it, even in southern hemisphere, now it
// just stops here" -- with the view pinned and the green arrow still pointing
// down past the bottom of the screen.
//
// The aim had a floor of 30 degrees below the horizon, added with the tap and
// drag so that "a drag must never get somewhere the buttons cannot". That is
// a good rule for WANDERING. Then travelling-to-a-target was routed through
// the same clamp, and the ISS -- which spends much of its orbit far below
// -30, as do the Moon and half the planets -- became a destination the app
// would offer, describe in words as being under the ground, and then decline
// to actually reach.
//
// The clamp lives here, and is pure, for a reason worth keeping: it produced
// a user-visible bug while sitting in app.js where no test could reach it.
//
// THE TWO FLOORS ARE NOW ONE. The floor stayed an argument for a while,
// because how far down you may wander and how far down you may be SENT were
// different questions. They are not any more: the hand fence at -30 cost a
// freeze (see below), stopped making sense once the ground became a
// see-through wireframe, and was already being overruled by the app's own
// targets. Hands and targets share -89. The argument stays because the
// function is pure and a limit is worth passing in rather than baking in.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const HAND = -30, TARGET = -89;

test('azimuth comes back onto the compass, whatever it is given', () => {
  assert.equal(clampAim(370, 0, HAND).az, 10);
  assert.equal(clampAim(-10, 0, HAND).az, 350);
  assert.equal(clampAim(0, 0, HAND).az, 0);
});

test('steering stops at the floor it is given', () => {
  assert.equal(clampAim(0, -60, HAND).alt, HAND,
    'a floor passed in is a floor honoured');
  assert.equal(clampAim(0, 120, HAND).alt, 89,
    'and the zenith is the top, because the readout needs an azimuth');
});

test('a target reaches what the app said was there', () => {
  // THE REPORTED CASE. An ISS at 62 degrees below the horizon is a real and
  // ordinary position for it, and the ring is already on it.
  assert.equal(clampAim(0, -62, TARGET).alt, -62,
    'the view must be able to arrive where it is pointing the arrow');
  assert.equal(clampAim(0, -95, TARGET).alt, TARGET,
    'straight down is still the end of the sky');
});

test('a floor computed from where the view IS would ratchet, and did', () => {
  // WHY THERE IS ONLY ONE FLOOR NOW, kept as arithmetic because the argument
  // is easier to believe than to describe.
  //
  // The hand floor was once min(-30, current alt) -- derived from wherever
  // the view happened to BE, so that a target could carry you below -30 and
  // your hands could still climb back. Every upward move raised the floor to
  // the new altitude, and downward movement died for good. Targeting the Sun
  // at night lands near -59, and the first thing anyone does there is drag
  // down. "The manual buttons and drag do not work, they do nothing."
  const ratchet = (alt, d) => Math.max(Math.min(HAND, alt), Math.min(89, alt + d));
  let alt = -59;
  assert.equal(ratchet(alt, -15), -59, 'down from the Sun did nothing at all');
  alt = ratchet(alt, 15);
  assert.equal(alt, -44, 'up worked, which is what made it look like a freeze');
  assert.equal(ratchet(alt, -15), -44, 'and down did nothing again, one rung higher');

  // A FIXED floor cannot do that, whatever it is set to. That is the whole
  // fix: the limit may not be a function of the position it limits.
  const fixed = (alt, d) => Math.max(TARGET, Math.min(89, alt + d));
  alt = -59;
  assert.equal(fixed(alt, -15), -74, 'down from the Sun works');
  assert.equal(fixed(fixed(alt, 15), -15), -59, 'and the way back is open');
  assert.equal(fixed(TARGET, -15), TARGET, 'the bottom is still the bottom');
});

test('the app asks one question, in one place', () => {
  // It used to be four calls and two meanings, and getting one wrong is
  // exactly how the ISS bug happened. Now every way of steering ends up in
  // setQuat, which applies the same limit to all of them.
  assert.match(appJs, /const handFloor = \(\) => TARGET_MIN_ALT;/,
    'hands and targets must share a floor');
  assert.match(appJs, /const AIM_MAX_ALT = 89;/);
  assert.match(appJs, /const TARGET_MIN_ALT = -89;/);
  const setQuat = appJs.slice(appJs.indexOf('function setQuat('),
    appJs.indexOf('\n}', appJs.indexOf('function setQuat(')));
  assert.match(setQuat, /quat\.clampAltitude\(quat\.normalize\(q\), handFloor\(\), AIM_MAX_ALT\)/,
    'the one writer must be the one place the limit is applied');

  // THE LIMIT IS A LEAN, NOT A STOP. The angle clamp rebuilt the view from
  // az/alt, which threw the rotation away; worse, in the drag solver a step
  // that would overshoot was refused WHOLE rather than taken partway, so the
  // view stopped a full drag-length short -- a wall at 71 degrees with the
  // limit at 89. clampAltitude turns the view back about its own right axis
  // by exactly the excess, so it slides along the limit instead.
  const glide = appJs.slice(appJs.indexOf('function glideTo('),
    appJs.indexOf('function pan('));
  assert.match(glide, /clampAim\(az, alt, TARGET_MIN_ALT, AIM_MAX_ALT\)/,
    'the journey must know its destination is reachable before it starts');
  assert.ok(!/floor = |floor,|floor:/.test(glide),
    'a per-caller floor is what made the two limits drift apart');
});
