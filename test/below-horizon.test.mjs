import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView, MOON_SET_ALT, PLANET_SET_ALT } from '../site/src/skydraw.js';
import {
  altAzToVector, vectorToAltAz, equatorialToVector, belowHorizonWay,
} from '../site/src/skyview.js';
import { moonPosition, moonRiseSet } from '../site/src/moon.js';
import { julianDay, lstHours } from '../site/src/astro.js';

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
//
// THE PLANETS THEN CAME BACK. The ground became a see-through wireframe so
// that a set planet you are pointing at does not vanish -- and the planet
// gate, written for the solid ground, went on hiding it: ring on the path,
// nothing inside. "planets should be visible even if set."
//
// THEN THE MOON. "The moon is not showing": 30 degrees under the EASTERN
// horizon, two hours before it rose, with an empty ring and a caption saying
// "Moon -- has set". Two things wrong. The Moon had kept the gate the planets
// lost, and "has set" was the only thing the app knew how to say about a body
// below the horizon -- true on the west side, false on the east. The Moon is
// now painted wherever it is, and the words say which way it is going.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const skydraw = readFileSync(
  fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');

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
function frameWithMoonAt(alt, az = 248) {
  const ctx = stubCtx();
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
    // which would make these tests pass for the wrong reason.
    targetAlt: alt, targetAz: az, targetName: 'Target',
    w: 780, h: 520, fov: 65, night: false,
  });
  return ctx;
}

test('a Moon below the horizon is painted under the ground, and named', () => {
  // The first report, to the degree: 57 below, dead centre of the view.
  assert.ok(frameWithMoonAt(-57).texts.includes('Moon'),
    'a Moon under the ground must be drawn through the wireframe');
  // The second report, to the degree: 30 below, due east, about to rise.
  assert.ok(frameWithMoonAt(-30, 88).texts.includes('Moon'),
    '"The moon is not showing" -- it must be');
  assert.ok(frameWithMoonAt(30).texts.includes('Moon'), 'and up, of course');
  assert.doesNotMatch(skydraw, /o\.moon\.alt >/,
    'the renderer must not gate the Moon on altitude anywhere, painter or label layout');
});

/** Render one frame with a planet at a given altitude, aimed straight at it. */
function frameWithPlanetAt(alt) {
  const ctx = stubCtx();
  const az = 264;
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null, iss: null,
    moon: null, planetArt: null,
    planets: [{
      name: 'Jupiter', alt, az, v: altAzToVector(alt, az),
      vNorth: altAzToVector(alt + 0.25, az), vEast: altAzToVector(alt, az + 0.25),
      magnitude: -2.5, colour: '#f2e6c8', illuminated: 1, ringTilt: null,
    }],
    aim: { az, alt },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: alt, targetAz: az, targetName: 'Target',
    w: 780, h: 520, fov: 65, night: false,
  });
  return ctx;
}

test('a planet that has set is still painted, and named', () => {
  // The reported case: Jupiter, ringed on its own path, and not there.
  assert.ok(frameWithPlanetAt(-12).texts.includes('Jupiter'),
    'a set planet must be drawn under the wireframe ground');
  assert.ok(frameWithPlanetAt(30).texts.includes('Jupiter'), 'and up, of course');
  assert.doesNotMatch(skydraw, /p\.alt <= PLANET/,
    'the renderer must not gate a planet on altitude anywhere');
});

test('the caption says which way it is going, and the status line stops calling the ring empty', () => {
  const label = appJs.slice(appJs.indexOf('function targetLabel('),
    appJs.indexOf('function targetIsPainted('));
  assert.match(label, /targetIsBelow\(t\) \? `\$\{t\.name\} — \$\{belowHorizonWords\(t\)\}` : t\.name/);
  const below = appJs.slice(appJs.indexOf('function targetIsBelow('),
    appJs.indexOf('function belowHorizonWords('));
  assert.match(below, /PLANET_NAMES\.includes\(guideTarget\)\) return t\.alt <= PLANET_SET_ALT;/,
    'a planet is below at the exported threshold');
  assert.match(below, /guideTarget === 'moon'\) return t\.alt <= MOON_SET_ALT;/,
    'and so is the Moon, at its own');
  const block = appJs.slice(appJs.indexOf('} else if (ringOn && targetIsBelow(ringOn))'),
    appJs.indexOf("$('skyTarget').textContent = '';"));
  assert.match(block, /drawn through the/, 'the words say the body is there');
  assert.doesNotMatch(block, /the ring is empty/, 'because it is not');
  assert.match(block, /It \$\{belowHorizonWords\(ringOn\)\}\./, 'and which way it is going');
  assert.doesNotMatch(appJs, /targetHasSet/,
    'the old name said "set" of everything below, rising or not');
});

test('the words: rising, set, or never', () => {
  const fn = appJs.slice(appJs.indexOf('function belowHorizonWords('),
    appJs.indexOf('function aimAtPole('));
  assert.match(fn, /belowHorizonWay\(t\.alt, t\.az, site\.lat\)/,
    'from the rule the tests below check against the real sky');
  assert.match(fn, /'rising'\) return 'has not risen yet'/);
  assert.match(fn, /'never'\) return 'never rises from here'/);
  assert.match(fn, /return 'has set';/);
});

test('the Moon\'s threshold is one degree, and refraction is why', () => {
  // A Moon geometrically just below the horizon really is visible, lifted by
  // the atmosphere, so its caption starts one degree down. It no longer
  // decides whether the Moon is drawn: nothing does.
  assert.equal(MOON_SET_ALT, -1);
  assert.equal(PLANET_SET_ALT, 0);
  assert.ok(frameWithMoonAt(-0.5).texts.includes('Moon'));
  assert.ok(frameWithMoonAt(-1.5).texts.includes('Moon'));
});

test('the renderer and the words read the same threshold', () => {
  // THE DRIFT THIS PREVENTS IS NOT HYPOTHETICAL. The label reserver once had
  // its own copy of the planet gate and NO copy of the Moon's, so with the
  // Moon under the ground it still pushed neighbouring labels aside to keep
  // room for a word it never painted.
  assert.match(appJs, /MOON_SET_ALT, PLANET_SET_ALT(?:, SUN_MIN_ALT)?,?\s*\n?\} from '\.\/skydraw\.js'/,
    'the app must import the thresholds rather than keep its own copy');
  const fn = appJs.slice(appJs.indexOf('function targetIsPainted('),
    appJs.indexOf('function targetIsBelow('));
  assert.doesNotMatch(fn, /moon|MOON/, 'the Moon is painted wherever it is');
  assert.doesNotMatch(fn, /PLANET/, 'and so is a planet');
  assert.match(fn, /return true;/,
    'the pole is a place rather than a body, and the ISS says this itself');
});

test('the status line explains an empty ring, and says which way it is going', () => {
  const block = appJs.slice(appJs.indexOf('} else if (ringOn && !targetIsPainted'),
    appJs.indexOf('} else if (ringOn && targetIsBelow(ringOn))'));
  assert.match(block, /BELOW the/, 'it must say which side of the horizon');
  assert.match(block, /under the ground from here/,
    'in the same words the ISS already uses, so the app has one voice');
  assert.match(block, /the ring is empty/,
    'it must explain the empty ring, which is the thing being looked at');
  assert.match(block, /it \$\{belowHorizonWords\(ringOn\)\}\./);
});

// --- which way through the horizon, against the real sky ---------------------

const DEG = Math.PI / 180;

/** Where the app's own Moon series puts the Moon, as altitude and azimuth. */
function moonAltAz(date, lat, lon) {
  const m = moonPosition(date);
  return vectorToAltAz(equatorialToVector(m.ra, m.dec, lstHours(julianDay(date), lon), lat));
}

/** Where a fixed point of the sky is, as altitude and azimuth. */
function starAltAz(ra, dec, date, lat, lon) {
  return vectorToAltAz(equatorialToVector(ra, dec, lstHours(julianDay(date), lon), lat));
}

test('the reported moment: 30 degrees under the eastern horizon, and rising', () => {
  // Kelly's screenshot: Az 88 E, Alt -30, "Moon -- has set", north of
  // Houston, 2026-09-23 about 3:15 pm CDT.
  const lat = 30.06, lon = -95.21;
  const at = new Date('2026-09-23T20:15:44Z');
  const m = moonAltAz(at, lat, lon);
  assert.ok(m.alt < -25 && m.alt > -35, `alt ${m.alt.toFixed(1)}`);
  assert.ok(Math.abs(m.az - 88) < 5, `az ${m.az.toFixed(1)}`);
  assert.equal(belowHorizonWay(m.alt, m.az, lat), 'rising');
  // And the app's own rise time agrees it was still to come, that evening.
  const { rise } = moonRiseSet(at, lat, lon);
  const hours = (rise - at) / 3600000;
  assert.ok(hours > 1 && hours < 4, `rises ${hours.toFixed(2)} h later`);
});

test('rising means the altitude is climbing, at any latitude, for a month of Moons', () => {
  // The rule is geometry -- east of the meridian, the hour angle is past
  // twelve and the altitude grows -- so check it against the thing it is a
  // rule about: two minutes later, is the Moon higher?
  for (const [lat, lon] of [[30.06, -95.21], [-33.87, 151.21], [51.48, 0], [64.84, -147.72]]) {
    let checked = 0;
    for (let i = 0; i < 30 * 72; i++) {
      const t = new Date(Date.UTC(2026, 8, 1) + i * 20 * 60000);
      const now = moonAltAz(t, lat, lon);
      if (now.alt >= 0) continue;
      // Near the meridian the altitude is at its turning point and the
      // Moon's own drift in declination can win for a while. The turning
      // point is in HOUR ANGLE, not azimuth: close to the nadir a few minutes
      // of hour angle sweep through tens of degrees of azimuth.
      const ha = lstHours(julianDay(t), lon) * 15 - moonPosition(t).ra;
      if (Math.abs(Math.sin(ha * DEG)) < 0.1) continue;
      const way = belowHorizonWay(now.alt, now.az, lat);
      if (way === 'never') continue;
      const later = moonAltAz(new Date(t.getTime() + 2 * 60000), lat, lon);
      assert.equal(way === 'rising', later.alt > now.alt,
        `${t.toISOString()} at ${lat}: alt ${now.alt.toFixed(2)} az ${now.az.toFixed(1)} said ${way}`);
      checked++;
    }
    assert.ok(checked > 500, `only ${checked} below-horizon moments at ${lat}`);
  }
});

test('the Southern Cross never rises from Houston, and does from Miami', () => {
  // Acrux, the foot of the Cross: a real answer of "never", which "not risen
  // yet" would make a lie of. From Houston its highest is under the ground;
  // from Miami, four degrees further south, it clears the horizon.
  const ra = 186.65, dec = -63.1;
  for (let h = 0; h < 24; h += 1) {
    const t = new Date(Date.UTC(2026, 8, 23, h));
    const hou = starAltAz(ra, dec, t, 30.06, -95.21);
    assert.ok(hou.alt < 0);
    assert.equal(belowHorizonWay(hou.alt, hou.az, 30.06), 'never', `hour ${h}`);
    const mia = starAltAz(ra, dec, t, 25.76, -80.19);
    if (mia.alt < 0) assert.notEqual(belowHorizonWay(mia.alt, mia.az, 25.76), 'never', `hour ${h}`);
  }
});

test('at the pole nothing below rises, and the south turns the same way', () => {
  // At the north pole the sky turns flat round the horizon: below is below.
  assert.equal(belowHorizonWay(-10, 90, 90), 'never');
  assert.equal(belowHorizonWay(-10, 270, 90), 'never');
  // In the southern hemisphere the sky still turns westward, so east is
  // still rising -- checked above against the Moon from Sydney, and here
  // directly: a point on the celestial equator an hour before it rises.
  const t = new Date('2026-09-23T00:00:00Z');
  const lst = lstHours(julianDay(t), 151.21);
  const ra = ((lst + 7) * 15) % 360;          // hour angle -7h: under the east
  const p = vectorToAltAz(equatorialToVector(ra, 0, lst, -33.87));
  assert.ok(p.alt < 0 && p.az > 0 && p.az < 180, `alt ${p.alt} az ${p.az}`);
  assert.equal(belowHorizonWay(p.alt, p.az, -33.87), 'rising');
});
