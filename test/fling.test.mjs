import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// LETTING GO OF THE SKY.
//
// "on click drag it just stops when released, it should de-accelerate."
//
// A drag that stops dead the instant the finger lifts is a drag that fights
// you: the sky is a big thing to move and the screen is a small window onto
// it, so crossing any distance meant a row of separate strokes for what the
// hand was doing as one gesture.
//
// IT IS NOT THE GLIDE. The glide has a destination and eases into it. This has
// no destination at all -- it keeps the speed the hand was already moving at
// and bleeds it away, so where it stops depends on how hard it was thrown.
// They are different enough that sharing a handle would mean one silently
// cancelling the other; the tests below pin them apart.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const flingFrom = appJs.slice(appJs.indexOf('function flingFrom('),
  appJs.indexOf('function cancelGlide('));

test('the speed decays instead of stopping', () => {
  assert.match(flingFrom, /Math\.exp\(-\(now - started\) \/ FLING_TAU\)/,
    'the coast must decay, not run at a constant speed and cut out');
  const tau = Number(appJs.match(/const FLING_TAU = (\d+);/)[1]);
  // Short enough to read as a release rather than a journey, long enough to
  // be a deceleration rather than a stutter.
  assert.ok(tau >= 100 && tau <= 400, `${tau}ms does not read as letting go`);
});

test('a normal throw carries a sane distance', () => {
  // WHAT THE CONSTANTS ACTUALLY MEAN, since the feel of this cannot be tested
  // in node -- and could not be checked in a browser either, because the
  // preview pane runs hidden and a hidden tab gets no animation frames at all.
  //
  // Exponential decay from v0 travels v0 * tau in total, so the constants ARE
  // the throw distance. A brisk finger moves the sky about 0.07 deg/ms; at
  // tau = 220 that coasts roughly 15 degrees, which is about a quarter of the
  // default 65-degree field. Far enough to be worth having, nowhere near far
  // enough to lose where you were -- which is the entire point of gliding
  // rather than cutting in the first place.
  const tau = Number(appJs.match(/const FLING_TAU = (\d+);/)[1]);
  const maxMs = Number(appJs.match(/const FLING_MAX_MS = (\d+);/)[1]);
  const brisk = 0.07;                       // degrees per millisecond
  const travelled = brisk * tau * (1 - Math.exp(-maxMs / tau));
  assert.ok(travelled > 5 && travelled < 30,
    `a brisk flick would move the sky ${travelled.toFixed(1)} degrees`);
  // And the hard end must not be the thing that stops it: cutting a coast off
  // mid-slide is the abrupt stop this replaced. Four time constants is 98%
  // done, so the end is a backstop rather than part of the feel.
  assert.ok(maxMs >= tau * 4,
    `FLING_MAX_MS ${maxMs}ms cuts the decay off while it is still moving`);
});

test('it ends, and does not coast for ever', () => {
  // A frame left scheduled for ever is a battery leak on a phone held up in a
  // field, which is the situation this whole app is for.
  assert.match(flingFrom, /now - started > FLING_MAX_MS/, 'there must be a hard end');
  assert.match(flingFrom, /fling = null;\s*\n\s*return;/,
    'the last frame must clear the handle rather than queue another');
  assert.match(appJs, /function cancelFling\(\) \{[\s\S]*?cancelAnimationFrame\(fling\.raf\)/,
    'cancelFling must actually drop the pending frame');
});

test('a hand beats a coast, and the coast is not its own hand', () => {
  // setAim cancels it, because touching the controls must take over at once.
  // But the coast STEERS through setAim, so without the flag its own first
  // frame would cancel it and the whole feature would be one frame long.
  const setAim = appJs.slice(appJs.indexOf('function setAim('),
    appJs.indexOf('function pan('));
  assert.match(setAim, /if \(!flingOwnMove\) cancelFling\(\);/,
    'setAim must cancel a coast, but not the one calling it');
  assert.match(flingFrom, /flingOwnMove = true;[\s\S]*?setAim\([\s\S]*?flingOwnMove = false;/,
    'the coast must mark its own moves');
  // And a finger back on the glass stops it dead, like a hand on a wheel.
  const down = appJs.slice(appJs.indexOf("$('liveSky').addEventListener('pointerdown'"),
    appJs.indexOf("$('liveSky').addEventListener('pointerdown'") + 400);
  assert.match(down, /cancelFling\(\);/, 'a new touch must stop the coast');
  assert.ok(down.indexOf('cancelFling()') < down.indexOf('if (!handSteering()) return;'),
    'it must stop even where a drag would not have started');
});

test('a finger that stopped before lifting threw nothing', () => {
  // Drag somewhere, hold still, let go: the sky must stay put. Without this a
  // careful drag-and-hold ends with the view drifting away under the hand,
  // which is the opposite of placing it exactly.
  assert.match(appJs, /const FLING_STALE_MS = (\d+);/);
  const up = appJs.slice(appJs.indexOf("window.addEventListener('pointerup'"),
    appJs.indexOf("window.addEventListener('pointercancel'"));
  assert.match(up, /performance\.now\(\) - d\.prev\.t\) < FLING_STALE_MS/,
    'a release must check how recently the sky actually moved');
  assert.match(up, /handSteering\(\) && d\.v && fresh/,
    'all four conditions must hold before anything coasts');
});

test('it fires wherever the drag moved the sky -- which is both sizes now', () => {
  // Windowed, a finger on the map used to scroll the PAGE, so a coast there
  // would have thrown the sky for a gesture aimed at the page. The map
  // steers in both sizes now (#106), and the coast follows the drag: the two
  // must agree, or a release windowed would stop dead.
  const up = appJs.slice(appJs.indexOf("window.addEventListener('pointerup'"),
    appJs.indexOf("window.addEventListener('pointercancel'"));
  // It WAS full screen only, because the drag was. The drag steers in both
  // sizes now (#106), and a coast that stopped dead in one of them would be
  // the "it just stops when released" report all over again, windowed.
  assert.ok(!/if \(fullOn &&/.test(up), 'the coast must not be gated to full screen');
  const move = appJs.slice(appJs.indexOf("window.addEventListener('pointermove'"),
    appJs.indexOf("window.addEventListener('pointerup'"));
  assert.ok(!/if \(!fullOn\) return;/.test(move),
    'the drag that feeds it is full screen only, and they must agree');
});

test('degrees, and the short way round', () => {
  // The speed carried into the release is in DEGREES because that is what the
  // release keeps changing. Measured with signedTurn, or a drag across due
  // north reads as a 359-degree lurch the other way and the sky sails off
  // backwards at enormous speed.
  const move = appJs.slice(appJs.indexOf("window.addEventListener('pointermove'"),
    appJs.indexOf("window.addEventListener('pointerup'"));
  assert.match(move, /signedTurn\(drag\.prev\.az, az\) \/ dt/,
    'azimuth speed must be the signed shortest turn');
  assert.match(move, /drag\.v\.az \* 0\.6 \+ v\.az \* 0\.4/,
    'one jittery frame at the moment of release must not decide the direction');
});

test('it holds still when the system asks it to', () => {
  // Large moving fields are a nausea and vertigo trigger. Motion nobody asked
  // to continue is the easiest kind to do without, so this one simply does
  // not happen -- the drag itself still works exactly as before.
  assert.match(flingFrom, /if \(wantsStill\(\) \|\| document\.hidden\) return;/,
    'reduced motion, and a hidden tab that would get no frames anyway');
  // Leaving mid-coast ENDS it rather than landing it. Unlike a journey it has
  // nowhere it was going, so finishing it on return would move the sky for a
  // gesture made minutes ago.
  const vis = appJs.slice(appJs.indexOf("addEventListener('visibilitychange'"),
    appJs.indexOf('function screenAngle()'));
  assert.match(vis, /cancelFling\(\); cancelGlide\(true\);/,
    'a coast is dropped where a journey is landed');
});
