import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// TAP TO CENTRE, DRAG TO MOVE -- UNDER ONE CONDITION.
//
// This app's second design constraint is that it is operable with one unsteady
// hand, a mouthstick, or a trackball. It used to say "single taps only, no
// drag" flatly. Kelly's amendment, which is a better rule than the one it
// replaced: gestures are fine "as long as a user has a button or easy
// accessible option ... as long as no feature is available for only
// non-disabled users."
//
// So the thing to protect is not the absence of dragging. It is that dragging
// is never the ONLY way to reach something. The pan pad goes everywhere the
// gesture goes, through the same function and the same limits -- the gesture
// is a shortcut for the buttons, never the other way round.
//
// The maths of the gesture is in screen-to-sky.test.mjs. This is the wiring,
// which is where the promise above actually gets kept or broken.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');

test('one function decides where the view may point', () => {
  assert.match(appJs, /const AIM_MIN_ALT = -30, AIM_MAX_ALT = 89;/,
    'the limits must be named once, not spelled into each caller');
  const clamp = appJs.slice(appJs.indexOf('function clampAim('),
    appJs.indexOf('function setAim('));
  assert.match(clamp, /AIM_MIN_ALT/, 'clampAim must apply the altitude floor');
  assert.match(clamp, /AIM_MAX_ALT/, 'clampAim must apply the altitude ceiling');
});

test('the pad, a tap and a drag all steer through it', () => {
  // THE PARITY RULE, as code. If any of these ever computed skyAim directly it
  // could reach somewhere the others cannot, and the gesture would become a
  // capability only some people have.
  const pan = appJs.slice(appJs.indexOf('function pan('),
    appJs.indexOf('function pan(') + 200);
  assert.match(pan, /setAim\(/, 'the pad must go through setAim');
  assert.ok(!/skyAim = \{/.test(pan), 'the pad must not set the aim itself');
  // Nothing builds an aim inline. Found by this test: aimAtPole assembled
  // one itself, so "Find the pole" at latitude 90 aimed a degree past where
  // the arrows may go -- an aim the buttons cannot hold is one they cannot
  // take back over from.
  // Anchored, so the declaration's starting value (`let skyAim = {...}`) is
  // not mistaken for a steering decision. It is where the view begins, not
  // somewhere anything aims it.
  assert.ok(!/^\s*skyAim = \{/m.test(appJs),
    'an aim is being built inline instead of coming from clampAim');
  // And every function that sets one asks clampAim for it.
  for (const fn of ['setAim', 'glideTo', 'aimAtPole']) {
    const start = appJs.indexOf(`function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is gone`);
    const body = appJs.slice(start, appJs.indexOf('\n}', start));
    assert.ok(body.includes('clampAim('),
      `${fn} sets the aim without going through clampAim`);
  }
  // And both gestures call it.
  const down = appJs.slice(appJs.indexOf("$('liveSky').addEventListener('pointerdown'"));
  // The drag sets the aim directly and the tap travels to it, but both go
  // through the clamp, which is what the parity rule is actually about.
  assert.match(down, /setAim\(/, 'the drag must steer through setAim');
  assert.match(down, /glideTo\(/, 'the tap must travel to its target');
});

test('a tap survives a shaky hand', () => {
  // The definition of "tap" has to tolerate wander, or the people this app is
  // for cannot tap at all.
  const m = appJs.match(/const TAP_SLOP = (\d+);/);
  assert.ok(m, 'TAP_SLOP is gone');
  assert.ok(Number(m[1]) >= 8,
    `${m[1]}px is too tight a definition of "did not move"`);
});

test('dragging never takes the page\'s scroll away', () => {
  // The app has already shipped one "the page will not scroll" bug. Windowed,
  // the map is inside a scrolling page and a finger dragged across it is how
  // that page is scrolled, so the pan is full-screen only and the browser is
  // only handed the pointer there.
  const move = appJs.slice(appJs.indexOf("window.addEventListener('pointermove'"),
    appJs.indexOf("window.addEventListener('pointerup'"));
  assert.match(move, /if \(!fullOn\) return;/,
    'the drag must do nothing outside full screen');
  const full = css.slice(css.indexOf('.live-sky.full canvas {'),
    css.indexOf('}', css.indexOf('.live-sky.full canvas {')));
  assert.match(full, /touch-action:\s*none/,
    'the full-screen canvas must take the pointer');
  // ...and nothing else may, or windowed scrolling dies.
  const others = css.split('touch-action').length - 1;
  assert.equal(others, 1,
    'touch-action appears more than once; only the full-screen canvas may set it');
});

test('a swipe is not a tap, even where dragging is switched off', () => {
  // Otherwise scrolling the page windowed would fling the view somewhere the
  // moment the finger lifted.
  const up = appJs.slice(appJs.indexOf("window.addEventListener('pointerup'"),
    appJs.indexOf("window.addEventListener('pointercancel'"));
  assert.match(up, /far >= TAP_SLOP \|\| !handSteering\(\)/,
    'pointerup must reject a swipe before treating it as a tap');
});

test('the browser taking the pointer away is not a tap either', () => {
  assert.match(appJs, /addEventListener\('pointercancel', \(\) => \{ drag = null; \}\)/,
    'a cancelled pointer must clear the drag');
});

test('the gestures are live exactly when the pad is', () => {
  // The pad is hidden while the phone is steering; the gestures must be off in
  // the same breath, or a stray touch fights the compass. Same expression, so
  // they cannot drift apart.
  const fn = appJs.slice(appJs.indexOf('function handSteering()'),
    appJs.indexOf('function handSteering()') + 200);
  assert.match(fn, /skyOn && !\(skyFollow && rawAlpha !== null\)/,
    'handSteering must be the pad\'s own condition');
  assert.match(appJs, /if \(card\) card\.open = !following;/,
    'the pad visibility rule this mirrors has moved');
});

test('the stated design constraint matches what the app now does', () => {
  // The header of style.css is the app's promise to its users. It said "no
  // drag" and a drag now exists; a constraint that is quietly untrue is worse
  // than one that was never written.
  const top = css.slice(0, css.indexOf(':root'));
  assert.ok(!/single taps only, no drag/.test(top),
    'the old flat "no drag" constraint is still there and is now false');
  assert.match(top, /NOTHING THAT ONLY A\s*\n \*\s*DRAG CAN DO/,
    'the constraint must state the rule the gesture was added under');
  assert.match(top, /pan pad reaches every direction/,
    'it must say why the gesture is allowed: the buttons reach the same places');
});
