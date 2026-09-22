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
  assert.match(appJs, /const AIM_MAX_ALT = 89;/,
    'the limits must be named once, not spelled into each caller');
  assert.match(appJs, /const TARGET_MIN_ALT = -89;/);
  // ONE LIMIT, THE SAME FOR EVERY WAY OF STEERING. There were two: hands were
  // fenced at -30 and only a target could go below it. The fence had to be
  // computed from where the view already was, and a limit derived from the
  // current position ratchets -- which froze the controls outright. It is
  // also no longer buying anything: the ground is a see-through wireframe,
  // and the app's own targets live down there.
  assert.match(appJs, /const handFloor = \(\) => TARGET_MIN_ALT;/,
    'hand steering and targets must share one floor');
  assert.ok(!/AIM_MIN_ALT/.test(appJs.replace(/^.*THERE USED TO BE.*$/gm, '')),
    'the second floor is gone; only the story about it may remain');

  // AND ONE WRITER. skyQuat is where the view points; skyAim is a derived
  // az/alt copy for the readout and the limits, which read it and never
  // write it. Two writers is how a clamp gets skipped.
  assert.match(appJs, /function setQuat\(q\) \{/, 'the one writer is gone');
  const writes = appJs.match(/^\s*sky(?:Quat|Aim) = /gm) || [];
  assert.equal(writes.length, 3,
    `skyQuat/skyAim assigned ${writes.length} times; only setQuat's own 3 are allowed`);
});

test('the pad, a tap and a drag all steer through it', () => {
  // THE PARITY RULE, as code. If any of these ever aimed the view itself it
  // could reach somewhere the others cannot, and the gesture would become a
  // capability only some people have.
  const pan = appJs.slice(appJs.indexOf('function pan('),
    appJs.indexOf('function pan(') + 200);
  assert.match(pan, /setAim\(/, 'the pad must go through setAim');
  // Nothing aims the view inline. Found by this test: aimAtPole assembled an
  // aim itself, so "Find the pole" at latitude 90 aimed a degree past where
  // the arrows may go -- an aim the buttons cannot hold is one they cannot
  // take back over from.
  for (const fn of ['setAim', 'glideTo', 'aimAtPole']) {
    const start = appJs.indexOf(`function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is gone`);
    const body = appJs.slice(start, appJs.indexOf('\n}', start));
    assert.ok(body.includes('setQuat('),
      `${fn} aims the view without going through setQuat`);
  }
  // And both gestures do too.
  const down = appJs.slice(appJs.indexOf("$('liveSky').addEventListener('pointerdown'"));
  assert.match(down, /setQuat\(/, 'the drag must steer through setQuat');
  assert.match(down, /glideTo\(/, 'the tap must travel to its target');
  // The drag solves against WHAT WAS GRABBED, every move. Stepping from the
  // last position instead rounds once per event, and thirty of those
  // compound into a drift the finger never asked for.
  assert.match(down, /grabbed: screenToVector\(at\.x, at\.y, basis, focal\),/,
    'the drag must remember what it grabbed');
  const move = appJs.slice(appJs.indexOf("window.addEventListener('pointermove'"),
    appJs.indexOf("window.addEventListener('pointerup'"));
  assert.match(move, /quat\.aimLevel\(drag\.grabbed,/,
    'every move must solve from what was grabbed, not from the previous event');
  // ...and with the SAME limits every other way of steering gets.
  assert.match(move, /skyQuat, handFloor\(\), AIM_MAX_ALT\)/,
    'the drag must be held to the shared floor and ceiling');
});

test('a tap survives a shaky hand', () => {
  // The definition of "tap" has to tolerate wander, or the people this app is
  // for cannot tap at all.
  const m = appJs.match(/const TAP_SLOP = (\d+);/);
  assert.ok(m, 'TAP_SLOP is gone');
  assert.ok(Number(m[1]) >= 8,
    `${m[1]}px is too tight a definition of "did not move"`);
});

test('the map steers in both sizes, and takes the pointer only while steering', () => {
  // It was full-screen only from the day it was added, so that a finger
  // across the windowed map still scrolled the page. "Manual mode no longer
  // works unless I'm full screen." The rule now: the pointer is the map's
  // while a hand is steering -- that is when a finger on it means "move the
  // sky" -- and the page's otherwise, so Auto Mode still scrolls from the
  // map and every mode scrolls from everywhere else.
  const move = appJs.slice(appJs.indexOf("window.addEventListener('pointermove'"),
    appJs.indexOf("window.addEventListener('pointerup'"));
  assert.ok(!/if \(!fullOn\) return;/.test(move), 'the drag must not be gated to full screen');
  assert.match(appJs, /\$\('liveSkyWrap'\)\.classList\.toggle\('steering', !following\);/,
    'the steering class must follow the same test the pad is shown by');
  const rule = css.slice(css.indexOf('.live-sky.full canvas,'),
    css.indexOf('}', css.indexOf('.live-sky.full canvas,')));
  assert.match(rule, /\.live-sky\.steering canvas \{/, 'the steering map takes the pointer');
  assert.match(rule, /touch-action:\s*none/);
  // The app has already shipped one "the page will not scroll" bug: this is
  // the only touch-action in the stylesheet, and it is conditional.
  const others = css.split('touch-action:').length - 1;
  assert.equal(others, 1, 'touch-action is set more than once');
  // And the coast after a release is no longer full-screen only either.
  const up = appJs.slice(appJs.indexOf("window.addEventListener('pointerup'"),
    appJs.indexOf("window.addEventListener('pointercancel'"));
  assert.match(up, /if \(handSteering\(\) && d\.v && fresh\) flingFrom/);
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

test('the gestures are live exactly when the on-map pad is', () => {
  // The on-map pad is hidden while the phone is steering; the gestures must be
  // off in the same breath, or a stray touch fights the compass. Same
  // expression, so they cannot drift apart.
  //
  // IT MIRRORS fullPan, NOT THE CARD. The Manual Controls card is opened by
  // the MODE, so that a card labelled Manual agrees with a button labelled
  // Auto. Whether a gesture is LIVE is a different question with a different
  // answer -- it depends on whether anything is actually steering right now,
  // which is what `following` means. Pointing this assertion at the card tied
  // two rules together that had quietly stopped being the same rule.
  const fn = appJs.slice(appJs.indexOf('function handSteering()'),
    appJs.indexOf('function handSteering()') + 200);
  assert.match(fn, /skyOn && !\(skyFollow && rawAlpha !== null\)/,
    'handSteering must be the pad\'s own condition');
  assert.match(appJs, /\$\('fullPan'\)\.hidden = following;/,
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
