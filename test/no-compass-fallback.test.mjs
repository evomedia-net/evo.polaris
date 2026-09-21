import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// AUTO MODE NEEDS A SENSOR, AND A DESKTOP WILL NEVER SAY SO.
//
// There is no event for "this device has no compass". Readings simply never
// arrive, and that is indistinguishable from one which has not reported YET
// until enough time has passed. So the app sat in Auto Mode for ever on every
// desktop -- following nothing, while the one mode button offered to switch
// to Manual as though Auto were the thing currently working.
//
// It surfaced sideways: "click and click drag works in auto-mode on PC, do we
// care since auto can't work on pc?". The gestures were not the problem --
// they are the only way to steer where nothing is steering, and taking them
// away would strand the desktop entirely. The MODE was the thing lying.
//
// Worth recording: the comment above `let skyFollow = true` claimed this
// fallback already existed, and had for a long time. It did not. `sawSensor`
// was the only thing watching for a first reading and all it did was trigger
// a redraw. A comment is not a mechanism.
//
// None of this can be run here: node has no DeviceOrientationEvent, and the
// behaviour is a race between a timer and a sensor that only exists on real
// hardware. So the rules are asserted against the source, and the reasoning
// is written down because the next person cannot run it either.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const watchdog = appJs.slice(appJs.indexOf('function watchForNoCompass()'),
  appJs.indexOf('// A toggle, not a one-way switch.'));

test('silence is the signal, because it is the only one there is', () => {
  const ms = Number(appJs.match(/const COMPASS_GRACE_MS = (\d+);/)[1]);
  // Long enough that a slow phone answering late is not thrown out of the
  // mode it asked for; short enough that a laptop is not left following
  // nothing while the screen says it is following something.
  assert.ok(ms >= 1000 && ms <= 6000,
    `${ms}ms is not a sensible wait for a first orientation reading`);
  assert.match(watchdog, /if \(rawAlpha !== null\) return;/,
    'a device that reported must keep the mode it was given');
});

test('it does not answer a question the user has not been asked', () => {
  // THE iOS TRAP. Nothing arrives there until the permission tap, so a naive
  // timer would drop every iPhone to Manual while the prompt was still owed
  // -- and the deferred-ask machinery exists precisely because that tap can
  // be an arbitrarily long time coming.
  assert.match(watchdog, /if \(compassPending\) return;/,
    'a pending permission is a human being slow, not a missing sensor');
  assert.match(watchdog, /if \(compassNeedsAsking\(\) && !compassGranted\) return;/,
    'an unanswered iOS prompt must not be read as "no compass here"');
});

test('it happens once, and not to someone who asked for Auto', () => {
  // Pressing Use Auto Mode on a laptop is a person who has been told what the
  // device can do choosing to be there anyway. Pulling them back out would
  // read as the button not working.
  assert.match(appJs, /let autoFellBack = false;/);
  assert.match(watchdog, /if \(autoFellBack \|\| compassWatchdog !== null\) return;/,
    'it must not re-arm, or every press of Use Auto Mode is undone 2.5s later');
  assert.match(watchdog, /autoFellBack = true;/);
  assert.match(watchdog, /if \(!skyFollow\) return;/,
    'a hand already steering has settled the question');
});

test('a reading calls the countdown off', () => {
  // Otherwise a phone that reports at 2.4s is dropped to Manual at 2.5s,
  // having just proved it can do the thing it is being told it cannot.
  // Sliced FORWARD from the function, not to a marker that happens to sit
  // earlier in the file -- indexOf from zero found the watchdog's own comment
  // above onOrientation and produced an empty string that asserted nothing.
  const at = appJs.indexOf('function onOrientation(e)');
  const onOrient = appJs.slice(at, appJs.indexOf('\n}', at));
  assert.match(onOrient, /clearTimeout\(compassWatchdog\)/,
    'the first reading must cancel the fallback');
  assert.match(onOrient, /compassWatchdog = null;/,
    'and clear the handle, or it can never be armed again');
});

test('it is armed by listening, not by hoping', () => {
  // The countdown starts where the app becomes ENTITLED to a reading: the
  // listener is attached. Starting it earlier would count the permission
  // dance against the sensor.
  const start = appJs.slice(appJs.indexOf('async function startCompass('),
    appJs.indexOf('// AUTO MODE NEEDS A SENSOR'));
  const attach = start.indexOf('addEventListener(orientEvent, onOrientation)');
  const arm = start.indexOf('watchForNoCompass()');
  assert.ok(attach > 0 && arm > attach,
    'the countdown must start after the listener is attached, not before');
});

test('the screen says what happened, rather than just changing', () => {
  // A mode that switches itself with no explanation is the app appearing to
  // have a mind of its own. It has a reason; it should give it.
  const manual = appJs.slice(appJs.indexOf('$(\'skyMode\').textContent = autoFellBack'),
    appJs.indexOf('// AUTO MODE is the phone steering'));
  assert.match(manual, /does not report which way it is/,
    'it must say the device cannot do it, not merely that the mode changed');
  assert.match(manual, /Auto Mode had nothing to follow/);
});

test('the comment that was wrong for a long time is now right', () => {
  // This is the whole point of the change: the documented behaviour and the
  // actual behaviour finally agree.
  const decl = appJs.slice(appJs.indexOf('// Following the phone is the DEFAULT'),
    appJs.indexOf('let skyFollow = true;'));
  assert.match(decl, /COMPASS_GRACE_MS/,
    'the comment must name the mechanism, not just promise the behaviour');
});
