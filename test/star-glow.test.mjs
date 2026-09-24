import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GLOW_MAX_MAG, GLOW_SCALE, SPIKE_ANGLES, spikeAngleFor, createStarGlow,
} from '../site/src/starglow.js';

// A BRIGHT STAR IS A GLOW WITH SPIKES.
//
// Kelly, looking at OpenSpace's sky: "some of the stars had streaks or had
// some kind of filters on them and they looked fairly realistic and a lot
// nicer." Then, on the first version: "I think there should be less glow. And
// I would make it so that they aren't all uniform facing the same direction,
// give them each a random rotation."
//
// The sprite itself needs a canvas, so what is checked here is the arithmetic
// that decides which sprite a star gets, and the source of the parts a canvas
// would draw. The picture was checked in a browser: at the widest field the
// seven Dipper stars carry crossed spikes at different angles while the field
// stays as dots, and a Night Mode frame has 2,926 lit pixels and NOT ONE with
// any green or blue in it.

const root = new URL('../site/', import.meta.url);
const glowJs = readFileSync(fileURLToPath(new URL('src/starglow.js', root)), 'utf8');
const skydraw = readFileSync(fileURLToPath(new URL('src/skydraw.js', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const sw = readFileSync(fileURLToPath(new URL('sw.js', root)), 'utf8');

// --- which way the spikes point ---------------------------------------------------

test('a star wears the same spike angle every time it is drawn', () => {
  // THE WHOLE POINT OF DERIVING IT FROM THE CATALOGUE NUMBER. Rolled fresh
  // each frame, the spikes would spin while you panned -- and a sky that
  // moves when you move is the one thing this view must never be.
  for (const hr of [1, 424, 2491, 4301, 5054, 9096]) {
    const first = spikeAngleFor(hr);
    for (let i = 0; i < 5; i++) assert.equal(spikeAngleFor(hr), first);
  }
});

test('every angle is one of the pre-rendered ones', () => {
  for (let hr = 1; hr <= 9110; hr++) {
    const a = spikeAngleFor(hr);
    assert.ok(Number.isInteger(a) && a >= 0 && a < SPIKE_ANGLES, `hr ${hr} gave ${a}`);
  }
});

test('the angles are spread, not dealt out in order', () => {
  // The catalogue is ordered by position, so consecutive numbers are
  // neighbours in the sky. Stepping through the angles in sequence would hand
  // one constellation a tidy rotating fan, which reads as a pattern rather
  // than as stars. A multiplicative hash breaks that up.
  const seen = new Array(SPIKE_ANGLES).fill(0);
  for (let hr = 1; hr <= 9110; hr++) seen[spikeAngleFor(hr)] += 1;
  for (const [i, n] of seen.entries()) {
    assert.ok(n > 9110 / SPIKE_ANGLES * 0.6, `angle ${i} only used ${n} times`);
  }
  // And neighbours must not simply walk up by one.
  let walked = 0;
  for (let hr = 1; hr < 400; hr++) {
    if (spikeAngleFor(hr + 1) === (spikeAngleFor(hr) + 1) % SPIKE_ANGLES) walked += 1;
  }
  assert.ok(walked < 120, `${walked} of 400 neighbours just stepped to the next angle`);
});

test('a star with no catalogue number still gets an angle', () => {
  for (const junk of [undefined, null, NaN, 'x', {}, Infinity]) {
    const a = spikeAngleFor(junk);
    assert.ok(Number.isInteger(a) && a >= 0 && a < SPIKE_ANGLES, `${junk} gave ${a}`);
  }
  assert.equal(spikeAngleFor(-4301), spikeAngleFor(4301), 'the sign is not information here');
});

// --- only the bright ones ------------------------------------------------------------

test('the glow stops well short of the faintest stars', () => {
  // A halo on every star swells the faint ones until the sky reads as fog and
  // the brightness ordering is lost -- which is the thing the map uses to say
  // which star you are looking at. The catalogue runs to 5.5.
  assert.equal(GLOW_MAX_MAG, 3.5);
  assert.ok(GLOW_MAX_MAG < 5.5, 'it must not reach the limiting magnitude');
  assert.equal(GLOW_SCALE, 4.6);
  assert.equal(SPIKE_ANGLES, 8);
});

test('the sprite is built from the colour the caller passes, not a second palette', () => {
  // A copy of the star palette here would be a second thing to keep in step,
  // and the one that drifts is always the one nobody is looking at.
  assert.match(glowJs, /sheet\(colour, night\)/);
  assert.match(glowJs, /const key = `\$\{night \? 'n' : 'd'\}:\$\{colour\}`/);
  assert.doesNotMatch(glowJs, /#a8c8ff|#fff6e0|#ffe0a8|#ffc080|#ff9e6e/,
    'no copy of starColour\'s table in this file');
});

test('with no canvas to draw on, it says so instead of throwing', () => {
  // node has no document. The app must survive the same absence -- a browser
  // that refuses a canvas should lose the glow, not the sky.
  const g = createStarGlow();
  assert.equal(g.sheet('#ffffff', false), null);
  assert.equal(g.draw({}, 0, 0, 2, '#ffffff', 4301, false), false);
  assert.equal(g.size, 1, 'and it remembers the failure rather than retrying every frame');
});

test('Night Mode keeps the red channel and nothing else', () => {
  // Verified in a browser too: a night frame had 2,926 lit pixels and zero
  // with green or blue. This holds the source that produced it.
  const night = glowJs.slice(glowJs.indexOf('if (night) {'), glowJs.indexOf('} else {'));
  for (const stop of night.match(/rgba?\([^)]*\)/g) || []) {
    const [r, g, b] = stop.replace(/rgba?\(|\)/g, '').split(',').map(Number);
    assert.equal(g, 0, `${stop} puts green on a night screen`);
    assert.equal(b, 0, `${stop} puts blue on a night screen`);
    assert.ok(r >= 0 && r <= 255);
  }
  // The spikes too: their ink and their fade are both red at night.
  assert.match(glowJs, /const ink = night \? '#cc0000' : colour;/);
  assert.match(glowJs, /const clear = night \? 'rgba\(204, 0, 0, 0\)' : 'rgba\(0, 0, 0, 0\)';/);
  // And the white core is day-only -- it is the one part that could not be red.
  const day = glowJs.slice(glowJs.indexOf('} else {'), glowJs.indexOf('g.fillStyle = rg;'));
  assert.match(day, /addColorStop\(0, '#ffffff'\)/);
});

// --- how the renderer uses it ---------------------------------------------------------

test('the glow is one composite for the whole pass, not one per star', () => {
  // 'lighter' makes two close stars add up instead of one painting over the
  // other. It must not reach the labels, which are ink. Setting and clearing
  // it per star would be a save/restore each for a flag two dozen need.
  const block = skydraw.slice(skydraw.indexOf('if (o.starGlow) {'),
    skydraw.indexOf('// Name only the bright'));
  assert.match(block, /ctx\.save\(\);\s*\n\s*ctx\.globalCompositeOperation = 'lighter';/);
  assert.match(block, /ctx\.restore\(\);/);
  assert.match(block, /if \(t\.s\.mag >= GLOW_MAX_MAG\) continue;/);
  assert.match(block, /o\.starGlow\.draw\(ctx, t\.x, t\.y, t\.r, starColour\(t\.s\.bv, night\), t\.s\.hr, night\)/,
    'the glow takes the same colour the dot would have used');
});

test('a star that got a glow does not also get a disc on top of it', () => {
  const block = skydraw.slice(skydraw.indexOf('for (const t of shown) {', skydraw.indexOf('ctx.restore();', skydraw.indexOf('if (o.starGlow) {'))),
    skydraw.indexOf('// Name only the bright'));
  assert.match(block, /if \(o\.starGlow && t\.s\.mag < GLOW_MAX_MAG\) continue;/);
});

test('the names are drawn last, so nothing is painted over them', () => {
  const stars = skydraw.indexOf('// STARS, IN THREE PASSES.');
  assert.ok(stars > 0, 'the three-pass comment is the marker for this block');
  const glowAt = skydraw.indexOf('if (o.starGlow) {', stars);
  const dotsAt = skydraw.indexOf('ctx.arc(t.x, t.y, t.r', stars);
  const namesAt = skydraw.indexOf('let labelled = 0;', stars);
  assert.ok(glowAt < dotsAt && dotsAt < namesAt,
    `order must be glow, dots, names — got ${glowAt}, ${dotsAt}, ${namesAt}`);
});

test('without the glow the renderer draws exactly what it always did', () => {
  // Every existing caller passes no starGlow at all, and must still get dots.
  const block = skydraw.slice(skydraw.indexOf('// STARS, IN THREE PASSES.'),
    skydraw.indexOf('// Name only the bright'));
  assert.match(block, /if \(o\.starGlow\) \{/, 'the glow pass is skipped entirely when there is none');
  assert.match(block, /if \(o\.starGlow && t\.s\.mag < GLOW_MAX_MAG\) continue;/,
    'and then every star gets its dot');
});

// --- the switch -------------------------------------------------------------------------

test('it is on by default, remembered, and switchable', () => {
  assert.match(appJs, /let skyStarGlow = store\.get\('starglow', true\);/);
  const h = appJs.slice(appJs.indexOf("$('skyStarGlow').onclick"), appJs.indexOf("$('skyMilky').onclick"));
  assert.match(h, /skyStarGlow = !skyStarGlow;/);
  assert.match(h, /store\.set\('starglow', skyStarGlow\);/);
  assert.match(h, /applyStarGlowLabel\(\);/);
  assert.match(h, /drawLiveSky\(\);/);
  assert.match(appJs, /starGlow: skyStarGlow \? starGlow : null,/, 'and the renderer is told');
  assert.match(appJs, /const starGlow = createStarGlow\(\);/);
});

test('the switch says what pressing it does, both ways', () => {
  assert.match(appJs, /\? 'Hide the star glow' : 'Show the star glow'/);
  assert.match(html, /id="skyStarGlow" class="big-btn">Hide the star glow</);
  // Beside the other picture switches, above the Milky Way.
  const settings = html.slice(html.indexOf('id="skyConst"'), html.indexOf('id="skyGround"'));
  assert.ok(settings.includes('id="skyStarGlow"'));
});

test('the module is cached for offline use', () => {
  assert.match(sw, /'\.\/src\/starglow\.js'/);
  assert.match(appJs, /import \{ createStarGlow \} from '\.\/starglow\.js';/);
  assert.match(skydraw, /import \{ GLOW_MAX_MAG \} from '\.\/starglow\.js';/);
});
