import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { easeOutCubic, easeInOutCubic, holdSpeed } from '../site/src/motion.js';

// PRESSING AN ARROW IS A NUDGE; HOLDING ONE IS A HOLD. NOTHING SNAPS.
//
// "In manual mode if you press the arrow, it snaps to the point. I would
// really prefer it to just slowly accelerate and stop." Then: "This should be
// much more fluid than it is."
//
// The arrows cut fifteen degrees per press. Now a press travels those
// fifteen degrees with an ease in and out, and a hold starts the sky moving,
// ramps it up to a cruising speed while the finger stays down, and coasts it
// out through the same momentum a released drag has. The finger decides how
// far.
//
// The curves live in motion.js as pure functions, because a frame loop
// cannot run here and a hidden browser tab does not run one either. The
// wiring is asserted against the source.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const sw = readFileSync(
  fileURLToPath(new URL('../site/sw.js', import.meta.url)), 'utf8');

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

// --- the curves ---------------------------------------------------------------

test('the nudge curve starts and ends at rest', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  close(easeInOutCubic(0.5), 0.5, 1e-12, 'symmetric about the middle');
  // Slow at both ends: the first and last tenths cover far less than a tenth
  // of the distance each. That is what "does not lurch, does not stop dead"
  // means as a number.
  assert.ok(easeInOutCubic(0.1) < 0.01, 'the start must be gentle');
  assert.ok(1 - easeInOutCubic(0.9) < 0.01, 'the end must be gentle');
  // And it never goes backwards.
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) { const v = easeInOutCubic(t); assert.ok(v >= prev); prev = v; }
});

test('the journey curve leaves quickly and settles gently, as it always did', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.25) > 0.5, 'more than half the way in the first quarter');
  assert.ok(easeOutCubic(0.5) > 0.85, 'it is the same 1 - (1-t)^3 the glide has used all along');
});

test('a hold ramps from nothing to cruise, smoothly', () => {
  assert.equal(holdSpeed(0), 0, 'the first frame of a hold must not jump');
  close(holdSpeed(600), 0.06, 1e-12, 'at the end of the ramp it is at cruise');
  assert.equal(holdSpeed(5000), holdSpeed(600), 'and stays there, however long it is held');
  // Smoothstep: half speed at half the ramp, and gentle at the start.
  close(holdSpeed(300), 0.03, 1e-12, 'half way up the ramp');
  assert.ok(holdSpeed(60) < 0.06 * 0.05, 'the first tenth of the ramp is barely moving -- "slowly accelerate"');
  let prev = -1;
  for (let ms = 0; ms <= 700; ms += 10) { const v = holdSpeed(ms); assert.ok(v >= prev); prev = v; }
});

test('cruise is a sane speed for a sky', () => {
  // 0.06 deg/ms is 60 degrees a second: the default field in about a
  // second, the whole horizon in six. Fast enough to get somewhere, slow
  // enough to stop where you meant to.
  const cruise = Number(appJs.match(/const HOLD_CRUISE = ([\d.]+);/)[1]);
  assert.ok(cruise >= 0.03 && cruise <= 0.12, `${cruise * 1000} deg/s`);
  const ramp = Number(appJs.match(/const HOLD_RAMP_MS = (\d+);/)[1]);
  assert.ok(ramp >= 300 && ramp <= 1200, `${ramp}ms to reach cruise`);
});

// --- the wiring -----------------------------------------------------------------

const nudge = appJs.slice(appJs.indexOf('function nudge('), appJs.indexOf('let hold = null;'));
const holdStart = appJs.slice(appJs.indexOf('function holdStart('), appJs.indexOf('function holdEnd('));
const holdEnd = appJs.slice(appJs.indexOf('function holdEnd('), appJs.indexOf('function wireArrow('));
const wire = appJs.slice(appJs.indexOf('function wireArrow('), appJs.indexOf('// --- touching the map'));

test('a press is a nudge: the old step, travelled, within the hand limits', () => {
  assert.match(nudge, /glideTo\(skyAim\.az \+ dAz, skyAim\.alt \+ dAlt,/, 'a nudge is a short journey');
  assert.match(nudge, /ease: easeInOutCubic/, 'with the curve that does not lurch');
  // IT USED TO PASS A FLOOR OF ITS OWN -- the arrows were fenced at -30 while
  // a target could go to -89. One limit now, applied in setQuat, so there is
  // nothing to pass and nothing to get wrong: the arrows reach exactly what a
  // tap, a drag and a target reach, because it is the same clamp.
  assert.ok(!/floor:/.test(nudge),
    'a per-caller floor is what let the arrows and the gesture disagree');
  assert.match(nudge, /ms: NUDGE_MS/);
  const ms = Number(appJs.match(/const NUDGE_MS = (\d+);/)[1]);
  assert.ok(ms >= 200 && ms <= 700, `${ms}ms is not a press`);
});

test('glideTo takes its duration and curve from the caller', () => {
  assert.match(appJs, /function glideTo\(az, alt, \{ ms = GLIDE_MS, ease = easeOutCubic \} = \{\}\)/,
    'the journey keeps its defaults; a nudge overrides them');
  const body = appJs.slice(appJs.indexOf('function glideTo('), appJs.indexOf('function pan('));
  assert.match(body, /const e = ease\(t\);/);
  assert.match(body, /clampAim\(az, alt, TARGET_MIN_ALT, AIM_MAX_ALT\)/,
    'the destination is checked before the journey starts');
  assert.match(body, /\(now - started\) \/ ms/, 'and the duration');
  // THE JOURNEY IS A ROTATION, not two numbers walked in step. Interpolating
  // az and alt separately crosses the 360 seam badly and cannot express a
  // path over a pole at all; slerp takes the short way round by construction.
  assert.match(body, /quat\.slerp\(fromQ, toQ, e\)/,
    'the frames in flight must interpolate the rotation');
});

test('a hold moves the sky through pan() every frame, ramping', () => {
  assert.match(holdStart, /holdSpeed\(now - hold\.t0, \{ ramp: HOLD_RAMP_MS, cruise: HOLD_CRUISE \}\)/);
  assert.match(holdStart, /pan\(hold\.v\.az \* dt, hold\.v\.alt \* dt\)/,
    'through pan, so it is setAim underneath: the same limits as every other hand');
  assert.match(holdStart, /Math\.min\(now - hold\.prev, 50\)/, 'a dropped frame must not teleport the sky');
  assert.match(holdStart, /cancelGlide\(\);\s*\n\s*cancelFling\(\);/, 'a finger going down takes over from any motion in flight');
  assert.match(holdStart, /if \(hold\) return;/, 'a second button while one is held does not start a second loop');
});

test('letting go: a short press was a tap, a long one coasts to a stop', () => {
  assert.match(holdEnd, /performance\.now\(\) - h\.t0 < TAP_HOLD_MS/);
  assert.match(holdEnd, /nudge\(h\.dAz \* STEP, h\.dAlt \* STEP\);/, 'a tap is one nudge of one step');
  assert.match(holdEnd, /flingFrom\(h\.v\.az, h\.v\.alt\);/,
    'a hold coasts out through the same momentum a released drag has -- which also honours reduced motion');
  assert.match(holdEnd, /cancelAnimationFrame\(h\.raf\)/, 'and the hold loop must stop, or it moves for ever');
  const ms = Number(appJs.match(/const TAP_HOLD_MS = (\d+);/)[1]);
  assert.ok(ms >= 120 && ms <= 400, `${ms}ms does not separate a tap from a hold`);
});

test('every arrow on both pads is wired, with a direction and not a distance', () => {
  for (const [id, az, alt] of [['skyUp', 0, 1], ['skyDown', 0, -1], ['skyLeft', -1, 0], ['skyRight', 1, 0],
                               ['fullUp', 0, 1], ['fullDown', 0, -1], ['fullLeft', -1, 0], ['fullRight', 1, 0]]) {
    assert.ok(appJs.includes(`['${id}', ${az}, ${alt}]`), `${id} must be wired as a unit direction`);
  }
  assert.match(wire, /addEventListener\('pointerdown'/);
  assert.match(wire, /addEventListener\('pointerup', up\)/);
  assert.match(wire, /addEventListener\('pointercancel', up\)/, 'the browser taking the pointer must end the hold');
  assert.match(wire, /addEventListener\('lostpointercapture', up\)/);
  // Capture can throw for a pointer the browser does not consider active --
  // assistive tech, anything synthesising events. Unguarded, it aborted the
  // press before the hold started AND left the fallback click marked as
  // handled, so the arrow did nothing at all. Found by pressing the button
  // with a synthetic pointer and watching nothing happen.
  assert.match(wire, /try \{ el\.setPointerCapture\(e\.pointerId\); \} catch/,
    'capture must be guarded, and the hold must start either way');
  assert.ok(wire.indexOf('el.setPointerCapture(') < wire.indexOf('holdStart(dAz, dAlt)'),
    'capture is attempted before the hold, so a failure to capture cannot end a hold already running');
});

test('a click with no pointer behind it is one press, and a click after one is ignored', () => {
  // Screen readers and Enter/Space synthesise a click and no pointer events;
  // a real finger produces both. The first must nudge; the second must not
  // nudge twice.
  assert.match(wire, /if \(performance\.now\(\) - pointerHandled < 600\) return;/);
  assert.match(wire, /nudge\(dAz \* STEP, dAlt \* STEP\);/);
});

test('the keyboard holds too: keydown starts, keyup releases, auto-repeat is ignored', () => {
  // Nothing here is a capability that belongs only to a finger.
  const kd = appJs.slice(appJs.indexOf("window.addEventListener('keydown', (e) => {\n  if (!skyOn"),
    appJs.indexOf("window.addEventListener('keyup'"));
  assert.match(kd, /if \(!e\.repeat\) holdStart\(\.\.\.moves\[e\.key\]\);/);
  assert.match(appJs, /window\.addEventListener\('keyup', \(e\) => \{[\s\S]*?holdEnd\(\);/);
});

test('the motion module ships offline with everything else', () => {
  assert.match(sw, /'\.\/src\/motion\.js'/);
});
