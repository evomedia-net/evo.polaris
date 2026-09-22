import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView, MOON_MIN_ALT, PLANET_MIN_ALT } from '../site/src/skydraw.js';
import { altAzToVector } from '../site/src/skyview.js';

// A RING AROUND NOTHING, AND NOT A WORD ABOUT WHY.
//
// Reported as "moon is gone". It was not: at the time of the report the Moon
// was 57 degrees BELOW the horizon at the user's site, so the renderer
// correctly did not paint it. Everything else carried on as though it had --
// the Moon stayed pickable, the view travelled to it, the ring landed on it
// and the caption said "Moon" over an empty circle, with the Moon's own
// dashed track running straight through it because tracks are drawn under the
// ground and bodies are not.
//
// So the app looked broken at the exact moment it was being most accurate.
// The ISS has always said this properly -- "it is under the ground from here,
// and the arrow points down at it" -- and the Moon and the planets now do too.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

/** A context that records the text drawn and the filled discs. */
function stubCtx() {
  const texts = [];
  const arcs = [];
  return {
    texts, arcs,
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, stroke() {}, moveTo() {}, lineTo() {},
    fill() {}, clearRect() {}, fillRect() {}, setLineDash() {}, clip() {},
    arc(x, y, r) { arcs.push({ x, y, r }); },
    ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t) { texts.push(String(t)); },
    strokeText(t) { texts.push(String(t)); },
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
}

/** Render one frame with the Moon at a given altitude, aimed straight at it. */
function frameWithMoonAt(alt) {
  const ctx = stubCtx();
  const az = 248;
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null, planets: null,
    iss: null,
    moon: {
      alt, az, v: altAzToVector(alt, az),
      vNorth: altAzToVector(alt + 0.25, az),
      vEast: altAzToVector(alt, az + 0.25),
      illuminated: 0.5, brightLimb: 90,
    },
    aim: { az, alt },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    // NOT 'Moon'. The reticle draws its own label, so a target named Moon
    // would put the word on the canvas whether or not the body was painted --
    // which is the very confusion being fixed, and would have made this test
    // pass for the wrong reason.
    targetAlt: alt, targetAz: az, targetName: 'Target',
    w: 780, h: 520, fov: 65, night: false,
  });
  return ctx;
}

test('a Moon that has set is not painted, and neither is its name', () => {
  // The reported case, to the degree: 57 below, dead centre of the view.
  const gone = frameWithMoonAt(-57);
  assert.ok(!gone.texts.includes('Moon'),
    'the Moon caption is drawn over a Moon that is under the ground');
  // And the control: the identical frame with it up.
  const up = frameWithMoonAt(30);
  assert.ok(up.texts.includes('Moon'),
    'the Moon is not being drawn at all — this test would pass on a broken '
    + 'renderer without this half');
});

test('the gate is one degree, and refraction is why', () => {
  // A Moon geometrically just below the horizon really is visible, lifted by
  // the atmosphere, so it keeps a degree of slack. A planet is a point of
  // light and gets none.
  assert.equal(MOON_MIN_ALT, -1);
  assert.equal(PLANET_MIN_ALT, 0);
  assert.ok(frameWithMoonAt(-0.5).texts.includes('Moon'),
    'a Moon within refraction of the horizon must still be drawn');
  assert.ok(!frameWithMoonAt(-1.5).texts.includes('Moon'),
    'a Moon well below it must not be');
});

test('the renderer and the words read the same threshold', () => {
  // THE DRIFT THIS PREVENTS IS NOT HYPOTHETICAL. The label reserver had its
  // own copy of the planet gate and NO copy of the Moon's, so with the Moon
  // under the ground it still pushed neighbouring labels aside to keep room
  // for a word it never painted.
  assert.match(appJs, /MOON_MIN_ALT, PLANET_MIN_ALT(?:, SUN_MIN_ALT)?,?\s*\n?\} from '\.\/skydraw\.js'/,
    'the app must import the gates rather than keep its own copy');
  const fn = appJs.slice(appJs.indexOf('function targetIsPainted('),
    appJs.indexOf('function aimAtPole('));
  assert.match(fn, /t\.alt > MOON_MIN_ALT/);
  assert.match(fn, /t\.alt > PLANET_MIN_ALT/);
  assert.match(fn, /return true;/,
    'the pole is a place rather than a body, and the ISS says this itself');
});

test('the status line says it has set, not nothing', () => {
  const block = appJs.slice(appJs.indexOf('} else if (ringOn && !targetIsPainted'),
    appJs.indexOf("$('skyTarget').textContent = '';"));
  assert.match(block, /BELOW the/, 'it must say which side of the horizon');
  assert.match(block, /under the ground from here/,
    'in the same words the ISS already uses, so the app has one voice');
  assert.match(block, /the ring is empty/,
    'it must explain the empty ring, which is the thing being looked at');
});
