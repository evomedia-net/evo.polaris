import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// IOS WILL ONLY ASK IF A FINGER ASKED FIRST.
//
// Reported from an iPhone: "it doesn't ask to allow to use location till you
// go into manual mode and back to auto".
//
// DeviceOrientationEvent.requestPermission() rejects unless it is called from
// a user gesture. The sky view turns the compass on the moment it opens, which
// is not one -- so the request was thrown away, a listener was attached to a
// sensor nobody had granted, and the view sat on "waiting for the phone's
// compass" for ever. Pressing Use Manual Mode and then Use Auto Mode was the
// only way through, because THAT press is a gesture. Nothing said so.
//
// This cannot be tested by running it: node has no DeviceOrientationEvent and
// no notion of user activation, and the behaviour lives entirely in Safari.
// So the rules are asserted against the source, and the reasoning is written
// down here because the next person will not be able to run it either.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const startCompass = appJs.slice(appJs.indexOf('async function startCompass('),
  appJs.indexOf('// A toggle, not a one-way switch'));

test('an ask without a gesture is deferred, not spent', () => {
  // The whole bug. Calling requestPermission outside a gesture does not queue
  // a prompt -- it rejects, and iOS remembers nothing, so the attempt is
  // simply wasted.
  assert.match(appJs, /function startCompass\(\{ gesture = false \} = \{\}\)/,
    'startCompass must know whether it was called from a gesture');
  assert.match(startCompass, /if \(!gesture\) \{ askOnNextGesture\(\); return; \}/,
    'without a gesture it must wait for one instead of asking and failing');
});

test('it waits for a completed tap, not the start of one', () => {
  // Safari counts a finished tap as the activation. A touch that turns into a
  // scroll is not one, so listening for pointerdown would burn the ask on a
  // gesture that never became a gesture.
  const fn = appJs.slice(appJs.indexOf('function askOnNextGesture()'),
    appJs.indexOf('async function startCompass('));
  assert.match(fn, /addEventListener\('click', ask, true\)/,
    'the deferred ask must wait for a click');
  assert.match(fn, /addEventListener\('keydown', ask, true\)/,
    'and a key, so it is reachable without a pointer at all');
  // The listener, not the word: the comment beside it names pointerdown as
  // the thing being avoided, and matching that was the test failing against
  // correct code.
  assert.ok(!/addEventListener\('pointerdown'/.test(fn),
    'pointerdown is not a completed gesture and Safari will refuse it');
  // Once only: a prompt that re-arms on every tap is a prompt that nags.
  assert.match(fn, /removeEventListener\('click', ask, true\)/);
  assert.match(fn, /if \(compassPending\) return;/,
    'arming twice would ask twice for the same permission');
});

test('a press asks outright, because a press IS the gesture', () => {
  // Both of these are real presses, so they must not defer -- deferring would
  // mean a second tap was needed for something the user just asked for.
  const modeBtn = appJs.slice(appJs.indexOf("$('modeBtn').onclick"),
    appJs.indexOf("$('modeBtn').onclick") + 400);
  assert.match(modeBtn, /startCompass\(\{ gesture: true \}\)/,
    'Use Auto Mode is a gesture and must ask straight away');
  const compassBtn = appJs.slice(appJs.indexOf("$('compassBtn').onclick"),
    appJs.indexOf("$('compassBtn').onclick") + 400);
  assert.match(compassBtn, /startCompass\(\{ gesture: true \}\)/,
    'the compass button is a gesture too');
});

test('opening the view does not count, and does not pretend to', () => {
  // The call that started all this. It stays -- opening the sky SHOULD want
  // the compass -- but it must go through the deferring path.
  const open = appJs.slice(appJs.indexOf('seedOrientation();'),
    appJs.indexOf('seedOrientation();') + 700);
  assert.match(open, /if \(skyFollow && !compassOn\) startCompass\(\);/,
    'opening the sky must still ask for the compass');
  assert.ok(!/startCompass\(\{ gesture: true \}\)/.test(open),
    'opening a pane is not a user gesture and must not claim to be one');
});

test('the screen says what it is waiting for', () => {
  // A permission prompt that appears on an unrelated tap is worse than one
  // you were told to expect. The old text said "waiting for the phone's
  // compass", which on an iPhone was waiting for something that would never
  // arrive.
  assert.match(appJs, /compassPending\s*\?/,
    'the status line must distinguish waiting-for-a-tap from waiting-for-a-sensor');
  assert.match(appJs, /Tap anywhere to let this phone share which/,
    'and say plainly that a tap is what is needed');
});

test('permission is remembered, so it is asked for once', () => {
  assert.match(appJs, /let compassGranted = false;/);
  assert.match(startCompass, /compassGranted = true;/,
    'a granted permission must be recorded');
  assert.match(startCompass, /if \(compassNeedsAsking\(\) && !compassGranted\)/,
    'and must short-circuit the whole dance next time');
});
