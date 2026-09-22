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
// The floor is an ARGUMENT because how far down you may wander and how far
// down you may be sent are different questions, and only the caller knows
// which it is asking.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const HAND = -30, TARGET = -89;

test('azimuth comes back onto the compass, whatever it is given', () => {
  assert.equal(clampAim(370, 0, HAND).az, 10);
  assert.equal(clampAim(-10, 0, HAND).az, 350);
  assert.equal(clampAim(0, 0, HAND).az, 0);
});

test('wandering stops at the floor', () => {
  assert.equal(clampAim(0, -60, HAND).alt, HAND,
    'the arrows must not walk off into the ground');
  assert.equal(clampAim(0, 120, HAND).alt, 89,
    'and must not pass the zenith, where the aim cannot be held');
});

test('a target reaches what the app said was there', () => {
  // THE REPORTED CASE. An ISS at 62 degrees below the horizon is a real and
  // ordinary position for it, and the ring is already on it.
  assert.equal(clampAim(0, -62, TARGET).alt, -62,
    'the view must be able to arrive where it is pointing the arrow');
  assert.equal(clampAim(0, -95, TARGET).alt, TARGET,
    'straight down is still the end of the sky');
});

test('the floor follows the view down, and never further', () => {
  // Once a target has taken you below the hand floor, the arrows have to work
  // FROM there. Re-applying a fixed -30 would snap the sky thirty degrees
  // upward on the first press, which is the sort of jump that loses people --
  // and would undo the journey the user just asked for.
  const arrived = -62;
  const floorNow = Math.min(HAND, arrived);
  assert.equal(clampAim(0, -70, floorNow).alt, arrived,
    'no further down by hand than the target already took it');
  assert.equal(clampAim(0, -55, floorNow).alt, -55, 'but it can look around');
  assert.equal(clampAim(0, 10, floorNow).alt, 10, 'and can always climb out');
});

test('the app asks the right question at each call site', () => {
  // Four calls, two meanings. Getting one wrong is exactly how this bug
  // happened, so which is which is pinned here rather than left to reading.
  assert.match(appJs, /const handFloor = \(\) => Math\.min\(AIM_MIN_ALT, skyAim\.alt\);/,
    'hand steering must use the following floor');
  assert.match(appJs, /const AIM_MIN_ALT = -30, AIM_MAX_ALT = 89;/);
  assert.match(appJs, /const TARGET_MIN_ALT = -89;/);
  // setAim is every hand path -- pad, tap and drag all go through it.
  const setAim = appJs.slice(appJs.indexOf('function setAim('),
    appJs.indexOf('function pan('));
  assert.match(setAim, /clampAim\(az, alt, handFloor\(\), AIM_MAX_ALT\)/,
    'a hand must not be given the target range');
  // ...and the journey is the one thing that may go the whole way.
  const glide = appJs.slice(appJs.indexOf('function glideTo('),
    appJs.indexOf('function cancelGlide(') > appJs.indexOf('function glideTo(')
      ? appJs.indexOf('function cancelGlide(')
      : appJs.length);
  // The floor is a parameter now -- a nudge from the arrows passes the hand
  // floor, a journey to a target takes the default -- so what is pinned is
  // the default, and that both the destination and every frame use the SAME
  // floor: clamping the steps to a different one would stall the animation
  // short of where it claims to arrive.
  assert.match(glide, /floor = TARGET_MIN_ALT/,
    'travelling to a target must default to the whole sky');
  const clampsWithFloor = glide.split('floor, AIM_MAX_ALT)').length - 1;
  assert.equal(clampsWithFloor, 2,
    'the destination and the frames in flight must use the same floor');
});
