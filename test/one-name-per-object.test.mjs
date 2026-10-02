import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSkyView } from '../site/src/skydraw.js';
import { altAzToVector } from '../site/src/skyview.js';

// ONE NAME PER OBJECT.
//
// "still lots of dupe names", with a screenshot showing "Mercury" three times
// in one small view -- the ring's caption, the planet's own label, and the
// track's label -- and "Pluto" three times and "Moon" twice in another.
//
// Three separate things name the same object and none of them knew the others
// existed. The near-miss fix that came before made it worse in a way that is
// worth writing down: `placed` stops labels OVERLAPPING by moving one of them
// somewhere else, so "Neptune" written over "Neptune" became "Neptune" here
// and "Neptune" a hundred pixels away. The collision went; the duplicate
// stayed, and now had room to be read.
//
// The rule is an order of precedence:
//
//   the ring's target   -> the ring names it
//   a body on screen    -> it names itself
//   neither             -> its track names it
//
// That last row is the entire reason track labels exist -- "which dashed line
// is this?" -- and it is the only case left that has to answer.

const ACCENT = '#7CFFB2';

function stubCtx() {
  const texts = [];
  // A name is drawn as a halo stroke in the sky's colour and then the fill on
  // top of it (#195): one name on screen, two calls. The fills are the names;
  // the halos are kept apart so a name FILLED twice still fails here.
  const halos = [];
  return {
    texts, halos,
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, stroke() {}, moveTo() {}, lineTo() {},
    fill() {}, clearRect() {}, fillRect() {}, setLineDash() {}, clip() {},
    arc() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t) { texts.push(String(t)); },
    strokeText(t) { halos.push(String(t)); },
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
}

/** A short path across the middle of the view, at the given altitude. */
function trackAt(label, alt, az0 = 0) {
  const points = [];
  for (let i = -6; i <= 6; i++) {
    const v = altAzToVector(alt, az0 + i * 2);
    points.push({ v, up: alt > 0 });
  }
  return { points, label, colour: '#ffe9a0', dash: [10, 8], width: 1.3 };
}

/** Render one frame and return every string the renderer painted. */
function labelsFor({ targetName = 'Mercury', planets, tracks, moon = null }) {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, iss: null,
    planets, tracks, moon,
    aim: { az: 0, alt: 20 },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 20, targetAz: 0, targetName,
    reticleR: 28,
    w: 900, h: 600, fov: 65, night: false,
  });
  return ctx.texts;
}

const mercury = {
  name: 'Mercury', alt: 20, az: 0, magnitude: 0,
  v: altAzToVector(20, 0), colour: '#e8e8e8',
};

const count = (texts, word) => texts.filter((t) => t === word).length;

test('the ring is on it, so it is named once', () => {
  // THE REPORTED CASE. Mercury targeted, Mercury on screen, Mercury's track
  // running through the view: three namers, one name.
  const texts = labelsFor({
    planets: [mercury],
    tracks: [trackAt('Mercury', 20)],
  });
  assert.equal(count(texts, 'Mercury'), 1,
    `"Mercury" appears ${count(texts, 'Mercury')} times: ${JSON.stringify(texts)}`);
});

test('and the one that survives is the ring caption', () => {
  // Not merely "one of them". The ring's is the biggest, is where the eye
  // already is, and is the one that says WHY the thing is circled -- so it
  // must be the survivor, and the other two the ones that stand down.
  const withRing = labelsFor({
    planets: [mercury], tracks: [trackAt('Mercury', 20)], targetName: 'Mercury',
  });
  const withoutRing = labelsFor({
    planets: [mercury], tracks: [trackAt('Mercury', 20)], targetName: 'Polaris',
  });
  assert.equal(count(withRing, 'Mercury'), 1);
  // With the ring elsewhere, the planet names itself instead -- still once.
  assert.equal(count(withoutRing, 'Mercury'), 1,
    'with the ring on something else the body must name itself, exactly once');
  assert.ok(withoutRing.includes('Polaris'), 'the ring still names its own target');
});

test('a caption that says more than the name still counts as the name', () => {
  // "Pluto — has set" is the ring naming Pluto. Matching the whole string
  // would let the path and the body both speak again.
  const texts = labelsFor({
    planets: [], tracks: [trackAt('Pluto', 20)], targetName: 'Pluto — has set',
  });
  assert.equal(count(texts, 'Pluto'), 0,
    'the path must not add a bare "Pluto" beside the ring caption');
  assert.ok(texts.includes('Pluto — has set'), 'the ring caption itself stays');
});

test('a path whose body is not on screen still says what it is', () => {
  // THE CASE TRACK LABELS EXIST FOR, and the one this must not break. Venus
  // is nowhere in the frame; without its path saying so, the dashes are an
  // anonymous line across the sky.
  const texts = labelsFor({
    planets: [mercury],
    tracks: [trackAt('Mercury', 20), trackAt('Venus', 25, 20)],
  });
  assert.ok(texts.includes('Venus'),
    'an unnamed dashed line is the one thing a track must never be');
  assert.equal(count(texts, 'Mercury'), 1);
});

test('a body under the ground does not silence its own path', () => {
  // The body is not drawn, so it never names itself -- which means the path
  // is the only thing left that can. Getting this backwards would take the
  // name off exactly the line that most needs one.
  const texts = labelsFor({
    planets: [{ ...mercury, alt: -40, v: altAzToVector(-40, 0) }],
    tracks: [trackAt('Mercury', 20)],
    targetName: 'Polaris',
  });
  assert.ok(texts.includes('Mercury'),
    'with the planet below the horizon its path must carry the name');
  assert.equal(count(texts, 'Mercury'), 1, 'but still only once');
});

test('the ring caption is reserved, not just drawn', () => {
  // It was never pushed into `placed`, so a path could be labelled straight
  // through it -- the "Pluto" lying across the Moon in the report. With the
  // ring's box claimed, a same-named path stands down anyway; this covers the
  // DIFFERENT-named path that would otherwise land on top of it.
  const texts = labelsFor({
    planets: [],
    tracks: [trackAt('Venus', 20)],      // straight through the ring's caption
    targetName: 'Mercury',
  });
  assert.ok(texts.includes('Mercury'), 'the ring caption is drawn');
  assert.ok(texts.includes('Venus'), 'and the path still gets its name somewhere');
  assert.equal(count(texts, 'Venus'), 1,
    'a path crowded by the caption should settle for one name, not none');
});

test('a namer you cannot see silences nothing', () => {
  // "from any view of an orbit line you should be able to know what it is."
  //
  // Precedence hands the name to the ring or the body -- but only if the
  // reader can actually SEE it. A target off the edge has no ring and no
  // caption, just an arrow; a planet off the edge draws no label. Letting
  // either of those count as "spoken" leaves an anonymous dashed line with
  // nothing on screen to explain it, which is the one thing a track must
  // never be.
  //
  // The aim here is 180 degrees away from everything, so the ring's target
  // and the planet are both far off the edge while the path still crosses
  // the view.
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, iss: null, moon: null,
    planets: [{ ...mercury, alt: 20, az: 180, v: altAzToVector(20, 180) }],
    tracks: [trackAt('Mercury', 20)],
    aim: { az: 0, alt: 20 },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    // Targeted, but behind you: an arrow, no ring, no caption.
    targetAlt: 20, targetAz: 180, targetName: 'Mercury',
    reticleR: 28,
    w: 900, h: 600, fov: 65, night: false,
  });
  assert.ok(ctx.texts.includes('Mercury'),
    'the path must name itself when nothing visible is naming it');
});

test('the Moon checks its bounds before claiming, like the planets do', () => {
  // The planets tested their position before claiming and the Moon did not,
  // so a Moon just off the edge counted as naming its own path and took the
  // label off it.
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, iss: null, planets: [],
    moon: {
      alt: 20, az: 180, v: altAzToVector(20, 180),
      vNorth: altAzToVector(20.25, 180), vEast: altAzToVector(20, 180.25),
      illuminated: 0.5, brightLimb: 90,
    },
    tracks: [trackAt('Moon', 20)],
    aim: { az: 0, alt: 20 },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 20, targetAz: 0, targetName: 'Polaris',
    reticleR: 28,
    w: 900, h: 600, fov: 65, night: false,
  });
  assert.ok(ctx.texts.includes('Moon'),
    'a Moon off the edge must not silence the Moon track');
});

// --- named stars, the case the first pass missed --------------------------------

/** A frame with Polaris drawn as a catalogue star, the ring on the given target. */
function frameWithPolaris(targetName) {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [{ v: altAzToVector(20, 0), mag: 2.0, hr: 424, bv: 0.6 }],   // HR 424 = Polaris
    constellations: null, milkyWay: null, tracks: null, planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 20 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 20, targetAz: 0, targetName, reticleR: 28,
    w: 900, h: 600, fov: 65, night: false, ground: false,
  });
  return ctx.texts;
}

test('a named star under the ring is named once, by the ring', () => {
  // Seen in a screenshot after the planets and paths were fixed: "Polaris"
  // as the ring's caption and "Polaris" again beside the dot, a finger apart.
  // The rule covered bodies and paths and not the catalogue stars, which
  // have their own label code.
  assert.equal(count(frameWithPolaris('Polaris'), 'Polaris'), 1);
});

test('and names itself when the ring is on something else', () => {
  const texts = frameWithPolaris('Target');
  assert.equal(count(texts, 'Polaris'), 1, 'the star must still get its own label');
  assert.ok(texts.includes('Target'), 'and the ring its own');
});
