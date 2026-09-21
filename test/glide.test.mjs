import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signedTurn } from '../site/src/guide.js';

// THE VIEW TRAVELS TO A TARGET INSTEAD OF CUTTING TO IT.
//
// Asked for after using it: the centre button should not "pop" to the target.
// A cut hands you a completely different picture with no clue how it relates
// to the one before, so the sky has to be read again from scratch -- and the
// whole promise of this view is that things are where they really are, which
// is a claim about how the sky is ARRANGED. Watching the stars slide past
// answers "where was I, relative to that?" for nothing.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const glideBody = appJs.slice(appJs.indexOf('function glideTo('),
  appJs.indexOf('\n}', appJs.indexOf('function glideTo(')));

test('the centre button travels, and so does a tap', () => {
  const pole = appJs.slice(appJs.indexOf("$('skyPole').onclick"),
    appJs.indexOf("$('modeBtn').onclick"));
  assert.match(pole, /glideTo\(/, 'the centre button must travel, not cut');
  assert.ok(!/aimAtPole\(\);/.test(pole),
    'the centre button must not also snap the aim before travelling');
  // The full-screen twin delegates, so it cannot drift from it.
  assert.match(appJs, /\$\('fullPole'\)\.onclick = \(\) => \$\('skyPole'\)\.click\(\);/);
});

test('a drag does NOT travel', () => {
  // A drag has to track the finger exactly. Easing it would read as the sky
  // lagging behind the hand, which is the opposite of the point.
  const move = appJs.slice(appJs.indexOf("window.addEventListener('pointermove'"),
    appJs.indexOf("window.addEventListener('pointerup'"));
  assert.match(move, /setAim\(/, 'the drag must set the aim directly');
  assert.ok(!/glideTo\(/.test(move), 'the drag must not be animated');
});

test('a hand on the controls beats an animation in flight', () => {
  // Pressing an arrow, or grabbing the sky, while the view is still travelling
  // must take over at once -- not fight the animation for the next 450ms.
  const setAim = appJs.slice(appJs.indexOf('function setAim('),
    appJs.indexOf('function pan('));
  assert.match(setAim, /cancelGlide\(\)/,
    'setAim must cancel a glide, or the animation keeps overwriting the aim');
  assert.match(glideBody, /cancelGlide\(\)/,
    'starting a glide must cancel the one before it');
});

test('azimuth travels the short way round', () => {
  // From 350 to 10 is twenty degrees clockwise, not three hundred and forty
  // the other way. Getting it wrong sends the whole sky the long way past
  // everything, which is worse than the cut this replaced.
  assert.match(glideBody, /signedTurn\(/,
    'the azimuth difference must be the signed shortest turn');
  // The helper this leans on, checked here so the behaviour is pinned even
  // though the animation itself cannot be run in node.
  assert.equal(signedTurn(350, 10), 20);
  assert.equal(signedTurn(10, 350), -20);
  assert.equal(Math.abs(signedTurn(0, 180)), 180);
});

test('it holds still when the system asks it to', () => {
  // NOT A STYLISTIC PREFERENCE. Large moving fields are a nausea and vertigo
  // trigger, and a full-screen sky sliding under you is about the largest
  // moving field this app can produce. The rest of the app already honours
  // the setting in CSS, so honouring it here is consistency, not a favour.
  assert.match(appJs, /prefers-reduced-motion: reduce/,
    'the animation must check the reduced-motion setting');
  assert.match(glideBody, /wantsStill\(\)/,
    'glideTo must check it before animating');
  // ...and when it is set, the view still ARRIVES. Holding still must not
  // mean not going.
  const guard = glideBody.slice(glideBody.indexOf('wantsStill()'));
  assert.match(guard, /skyAim = to;/,
    'with motion off the view must still reach the target, just instantly');
});

test('the journey is short enough to be a move, not a wait', () => {
  const m = appJs.match(/const GLIDE_MS = (\d+);/);
  assert.ok(m, 'GLIDE_MS is gone');
  const ms = Number(m[1]);
  // Started at 450ms and was reported as "way too fast"; halved to 900. The
  // upper bound is where a move stops being a move and becomes a wait.
  assert.ok(ms >= 200 && ms <= 1400,
    `${ms}ms is outside the range where this reads as one movement`);
});

test('the animation ends, and cleans up after itself', () => {
  // A frame left scheduled forever is a battery leak on a phone held up in a
  // field, which is exactly the situation this app is for.
  assert.match(glideBody, /glide = t < 1 \? \{ raf: requestAnimationFrame\(step\), to \} : null;/,
    'the last frame must clear the handle rather than queue another');
  const cancel = appJs.slice(appJs.indexOf('function cancelGlide('),
    appJs.indexOf('function glideTo('));
  assert.match(cancel, /cancelAnimationFrame\(glide\.raf\)/);
  assert.match(cancel, /glide = null/);
});

test('a journey interrupted by leaving the tab still lands', () => {
  // A hidden tab does not run requestAnimationFrame, so the animation simply
  // stalls -- and coming back to a view stranded half way between where you
  // were and where you asked to go is the worst of both. The app already
  // handles the same hazard for its other pending frame.
  const vis = appJs.slice(appJs.indexOf("addEventListener('visibilitychange'"),
    appJs.indexOf("function screenAngle()"));
  assert.match(vis, /cancelGlide\(true\)/,
    'hiding the tab must land the journey, not abandon it half way');
  // And one must not be STARTED in a hidden tab either: no frames arrive, so
  // it would strand the view until the tab came back.
  assert.match(glideBody, /document\.hidden/,
    'a glide begun in a hidden tab must arrive instead of animating');
  // ...whereas a hand on the controls abandons it where it is, because the
  // hand is steering now.
  const setAim = appJs.slice(appJs.indexOf('function setAim('),
    appJs.indexOf('function pan('));
  assert.match(setAim, /cancelGlide\(\)/,
    'a hand must not be dragged to the old target');
});
