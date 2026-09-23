import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView } from '../site/src/skydraw.js';
import { PLANET_NAMES, planetPosition } from '../site/src/planets.js';

// WHAT THE RING IS ON, CHOSEN FROM THE MAP.
//
// Four pickers in full screen: the pole, the station, the Moon, and one that
// walks the planets out from the Sun -- Mercury first, Pluto last, then
// nothing, then round again.
//
// "Nothing" is a real state, not an absence of one: the ring goes, the arrow
// goes, and the name above them goes. An arrow left pointing at whatever was
// targeted last would be worse than no arrow.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const ACCENT = '#7CFFB2';

function stubCtx() {
  const arcs = [], fills = [], texts = [];
  return {
    arcs, fills, texts, path: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() { this.path = []; }, closePath() {}, stroke() {},
    moveTo(x, y) { this.path.push([x, y]); },
    lineTo(x, y) { this.path.push([x, y]); },
    fill() { if (this.path.length >= 3) fills.push({ style: this.fillStyle }); },
    clearRect() {}, fillRect() {}, setLineDash() {}, clip() {},
    arc(x, y, r) { arcs.push({ r, stroke: this.strokeStyle }); },
    ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t) { texts.push(String(t)); }, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
}

/** Render one frame with the given target, off screen so the arrow would show. */
function frame(targetName) {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null,
    planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 45 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: -20, targetAz: 180, targetName,
    w: 780, h: 1688, fov: 65, night: false,
  });
  const accent = (xs) => xs.filter(
    (x) => String(x.stroke ?? x.style).toLowerCase() === ACCENT.toLowerCase());
  return {
    rings: accent(ctx.arcs).length,
    arrows: accent(ctx.fills).length,
    named: ctx.texts.includes(targetName),
  };
}

test('with nothing targeted there is no ring and no arrow', () => {
  const none = frame(null);
  assert.equal(none.rings, 0, 'a ring was drawn around nothing');
  assert.equal(none.arrows, 0,
    'an arrow was left pointing at whatever was targeted last');
});

test('with something targeted both come back', () => {
  const some = frame('Polaris');
  assert.equal(some.arrows, 1, 'the off-screen target must still be pointed at');
  assert.ok(some.rings <= 1);
});

// --- the cycle ---------------------------------------------------------------

test('the planets run out from the Sun and end with Pluto', () => {
  assert.deepEqual(PLANET_NAMES, [
    'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
  ], 'the cycle order is this list, so the list has to BE the order');
});

test('the cycle reads that list rather than keeping its own', () => {
  // A second list is a second thing to keep in step, and the one that drifts
  // is always the one nobody is looking at.
  const h = appJs.slice(appJs.indexOf("$('tgtPlanets').onclick"),
    appJs.indexOf("$('tgtPlanets').onclick") + 500);
  assert.match(h, /PLANET_NAMES\.length \+ 1/,
    'the extra step past the end is where "nothing" lives');
  assert.match(h, /PLANET_NAMES\[planetStep\]/,
    'the planet must come from the same list the map draws');
  assert.match(h, /'none'/, 'past the last planet the target must be cleared');
  assert.match(h, /keepCycle: true/,
    'the planets button must not reset the cycle it is walking');
});

test('choosing anything else drops out of the cycle', () => {
  // Otherwise the next press of Planets resumes halfway along, which is not
  // what "cycles through each one" means to anyone pressing it.
  assert.match(appJs, /function setTarget\(what, \{ keepCycle = false \} = \{\}\)/);
  assert.match(appJs, /if \(!keepCycle\) \{ planetStep = -1; constStep = -1; \}/);
  const pole = appJs.slice(appJs.indexOf("$('skyPole').onclick"),
    appJs.indexOf("$('skyPole').onclick") + 400);
  assert.match(pole, /planetStep = -1;/, 'the pole button must leave the cycle');
});

test('the pickers say which one is chosen, not what pressing does', () => {
  // These name the VALUE, like the hemisphere buttons do, so the state has to
  // be carried by aria-pressed -- otherwise it exists only as a ring
  // somewhere on the map, which is no use to a screen reader.
  for (const id of ['tgtPole', 'tgtIss', 'tgtMoon', 'tgtPlanets']) {
    assert.ok(html.includes(`id="${id}"`), `${id} is missing from the page`);
    const tag = html.slice(html.indexOf(`id="${id}"`) - 60,
      html.indexOf(`id="${id}"`) + 200);
    assert.match(tag, /aria-pressed="/, `${id} must carry its selected state`);
  }
  assert.match(appJs, /b\.setAttribute\('aria-pressed', on \? 'true' : 'false'\)/,
    'and it has to be kept in step with the target');
});

test('the map label names the target, and says when it has set', () => {
  // THE ROW UNDER THE BUTTONS IS GONE. The lit button says which target is
  // live, so a caption repeating it spent a row of screen twice -- and it
  // looked exactly like the buttons above it. What it alone carried, that a
  // target has SET, is on the map beside the ring, where anyone staring at
  // an empty circle is already looking, and in #skyTarget for a reader.
  assert.ok(!html.includes('fullTargetName'), 'the caption row must be gone');
  const label = appJs.slice(appJs.indexOf('function targetLabel('),
    appJs.indexOf('function targetIsPainted('));
  assert.match(label, /if \(!t\) return '';/, 'no target means no label');
  assert.match(label, /targetIsBelow\(t\) \? `\$\{t\.name\} — \$\{belowHorizonWords\(t\)\}` : t\.name/);
  // "has set", or "has not risen yet" on the east side -- see below-horizon.
  assert.match(appJs, /return 'has set';/);
  assert.match(appJs, /targetName: targetLabel\(target\),/,
    'and the map label is where that wording goes');
});

test('picking a target travels to it', () => {
  // "Point at the Moon" and "show me the Moon" are the same request; a ring
  // that moved off screen would leave only an arrow and no reason for it.
  const fn = appJs.slice(appJs.indexOf('function goToTarget('),
    appJs.indexOf('function goToTarget(') + 300);
  assert.match(fn, /glideTo\(t\.az, t\.alt\)/, 'the view must travel to it');
  assert.match(fn, /if \(t\)/, 'and must not try to travel to nothing');
});

// --- Pluto -------------------------------------------------------------------

test('Pluto is where Pluto actually is', () => {
  // Checked against its real position: through the late 2020s it sits in
  // Sagittarius and Capricornus, around 20h right ascension and 23 degrees
  // south, at about magnitude 14.
  const p = planetPosition('Pluto', new Date('2026-09-21T00:00:00Z'));
  assert.ok(p.ra > 295 && p.ra < 315, `Pluto RA ${p.ra.toFixed(1)}° is not where it should be`);
  assert.ok(p.dec > -26 && p.dec < -20, `Pluto Dec ${p.dec.toFixed(1)}°`);
  assert.ok(p.distanceAu > 30 && p.distanceAu < 40, `Pluto ${p.distanceAu.toFixed(1)} AU`);
  assert.ok(p.magnitude > 13 && p.magnitude < 16,
    `Pluto at magnitude ${p.magnitude.toFixed(1)} would be visible, and it is not`);
});

test('Pluto is the one nobody will see, and nothing pretends otherwise', () => {
  // Uranus is naked-eye in a dark sky and Neptune is binoculars. Pluto is
  // neither, by a wide margin, and the comment in planets.js says so -- the
  // ring around it means "it is in this direction", never "look and find it".
  const planets = readFileSync(
    fileURLToPath(new URL('src/planets.js', root)), 'utf8');
  const block = planets.slice(planets.indexOf('PLUTO IS HERE'),
    planets.indexOf('  Pluto: {'));
  assert.ok(/magnitude 14|beyond binoculars/i.test(block),
    'the note explaining that Pluto cannot be seen has gone');
});
