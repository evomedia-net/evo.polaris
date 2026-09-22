import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView, groundCells } from '../site/src/skydraw.js';
import { altAzToVector, basisFromAim, focalLength, projectToScreen } from '../site/src/skyview.js';

// THE GROUND HIDES THE SKY BELOW IT, THE WAY THE REAL ONE DOES.
//
// "a wireframe earth or something that really shows the horizon and blocks
// everything below it, but have the ability to turn the earth on and off in
// the viewport full screen".
//
// Until this, everything below the horizon was drawn through the ground --
// stars, the Milky Way photograph, the planets' paths -- with a comb of short
// ticks to say which way was down. The one thing you cannot see from the
// ground is through it, so a view that shows stars under the horizon is a
// view lying about what you can see.
//
// The ground is drawn after every sky layer and before the ring, the pointer
// and the ISS marker: the sky it covers is hidden, the markers on it are not.
// These tests drive the real renderer and read back the ORDER of what it
// painted, because order is the entire mechanism.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
const skydraw = readFileSync(
  fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');

const GROUND_FILL = '#0b0f19';
const ACCENT = '#7CFFB2';

/** A context that records every fill, stroke and arc, in order, with its style. */
function recordingCtx() {
  const ops = [];
  const c = {
    ops, path: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() { c.path = []; }, closePath() {},
    moveTo(x, y) { c.path.push([x, y]); }, lineTo(x, y) { c.path.push([x, y]); },
    fill() { ops.push({ op: 'fill', style: String(c.fillStyle), pts: c.path.slice() }); },
    stroke() { ops.push({ op: 'stroke', style: String(c.strokeStyle), pts: c.path.slice() }); },
    arc(x, y, r) { ops.push({ op: 'arc', style: String(c.strokeStyle), x, y, r }); c.path.push([x, y]); },
    clearRect() {}, fillRect(x, y, w, h) { ops.push({ op: 'fillRect', style: String(c.fillStyle), x, y, w, h }); },
    setLineDash() {}, clip() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t, x, y) { ops.push({ op: 'text', text: String(t), x, y }); }, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage() {},
  };
  return c;
}

const W = 900, H = 600;

/** One frame looking at the horizon, with a star in the sky and one under the ground. */
function frame({ ground, targetAlt = 30 } = {}) {
  const ctx = recordingCtx();
  const up = { v: altAzToVector(20, 0), mag: 1.0, hr: 424 };      // Yale HR 424 = Polaris: named
  const down = { v: altAzToVector(-20, 0), mag: 1.0, hr: 4301 };  // HR 4301 = Dubhe: named
  drawSkyView(ctx, {
    sky: [up, down], constellations: null, milkyWay: null, tracks: null,
    planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 0 },                      // straight at the horizon
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt, targetAz: 0, targetName: 'Target', reticleR: 28,
    w: W, h: H, fov: 65, night: false, ground,
  });
  return ctx.ops;
}

const groundFills = (ops) => ops.filter((o) => o.op === 'fill' && o.style === GROUND_FILL);
const starText = (ops, name) => ops.findIndex((o) => o.op === 'text' && o.text === name);
const ringIndex = (ops) => ops.findIndex((o) => o.op === 'arc' && o.style.toLowerCase() === ACCENT.toLowerCase());

// --- geometry ------------------------------------------------------------------

test('every ground cell is below the horizon, and the hemisphere is whole', () => {
  const cells = groundCells();
  assert.equal(cells.length, 36 * 9, 'ten-degree cells over a hemisphere');
  for (const cell of cells) for (const [alt] of cell) {
    assert.ok(alt <= 0 && alt >= -90, `a ground cell reached alt ${alt}`);
  }
  // The top row sits exactly on the horizon, so the fill meets the line with
  // no sliver of sky showing between them.
  assert.ok(cells.some((c) => c[0][0] === 0), 'the ground must start at the horizon itself');
});

// --- the mechanism: paint order --------------------------------------------------

test('with the ground on, a star under the horizon is painted over', () => {
  const ops = frame({ ground: true });
  const fills = groundFills(ops);
  assert.ok(fills.length > 50, `expected a painted hemisphere, got ${fills.length} ground fills`);
  // Dubhe was placed 20 degrees below the horizon, straight ahead. Its label
  // is drawn -- the renderer does not know about the ground when it draws
  // stars -- but the ground is painted AFTER it, so on a real canvas it is
  // covered. Order is the guarantee.
  const dubhe = starText(ops, 'Dubhe');
  assert.ok(dubhe >= 0, 'the test star under the ground was not drawn at all');
  const lastGround = ops.lastIndexOf(fills.at(-1));
  assert.ok(lastGround > dubhe, 'the ground must be painted after the stars, or it hides nothing');
  // ...and the star above the horizon is drawn too, before the ground, which
  // does not reach it: no ground fill has a corner above the horizon line.
  const basis = basisFromAim(0, 0), focal = focalLength(W, 65);
  const horizonY = H / 2 + projectToScreen(altAzToVector(0, 0), basis, focal).y;
  for (const f of fills) for (const [, y] of f.pts) {
    assert.ok(y >= horizonY - 1, `a ground cell reached ${(horizonY - y).toFixed(0)}px above the horizon`);
  }
});

test('the ring and the pointer stay on top of the ground', () => {
  // A target that has set keeps its marker: the sky it is in is hidden, the
  // ring saying "it is here, under the ground" is not.
  const ops = frame({ ground: true, targetAlt: -30 });
  const fills = groundFills(ops);
  const lastGround = ops.lastIndexOf(fills.at(-1));
  const ring = ringIndex(ops);
  assert.ok(ring > lastGround, 'the ring must be painted after the ground');
});

test('with the ground off, nothing is painted over and the old marks return', () => {
  const ops = frame({ ground: false });
  assert.equal(groundFills(ops).length, 0, 'no solid ground when it is off');
  assert.ok(starText(ops, 'Dubhe') >= 0, 'the set star is still drawn, for anyone who wants to see it');
});

test('the cardinal points sit on the ground, not under it', () => {
  const ops = frame({ ground: true });
  const fills = groundFills(ops);
  const lastGround = ops.lastIndexOf(fills.at(-1));
  const north = ops.findIndex((o) => o.op === 'text' && o.text === 'N');
  assert.ok(north > lastGround, 'N must be painted after the ground, or the ground covers it');
});

test('the projection edge is not painted across the canvas', () => {
  // A gnomonic projection sends a point 90 degrees from the centre to
  // infinity. A cell with a corner out there would be a wedge across the
  // whole picture. Looking straight down puts the whole hemisphere in view
  // and its rim at the edge of the projection.
  const ctx = recordingCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null, planets: null, moon: null, iss: null,
    aim: { az: 0, alt: -89 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 30, targetAz: 0, targetName: 'Target', reticleR: 28,
    w: W, h: H, fov: 170, night: false, ground: true,
  });
  for (const f of groundFills(ctx.ops)) for (const [x, y] of f.pts) {
    assert.ok(Math.abs(x) < W * 8 && Math.abs(y) < H * 8, `a ground corner at (${x.toFixed(0)}, ${y.toFixed(0)})`);
  }
});

// --- the controls ---------------------------------------------------------------

test('one switch, two places, and the words say what pressing does', () => {
  assert.match(html, /id="skyGround" class="big-btn">Hide the ground</,
    'the Visual Settings button must follow the button rule');
  assert.match(html, /id="fullGround"[^>]*aria-label="Hide the ground"/,
    'the full-screen glyph must carry the same words for a screen reader');
  assert.match(appJs, /\$\('fullGround'\)\.onclick = \(\) => \$\('skyGround'\)\.click\(\);/,
    'the full-screen button must press the real one, not keep its own state');
  const h = appJs.slice(appJs.indexOf("$('skyGround').onclick"), appJs.indexOf("$('skyGround').onclick") + 600);
  assert.match(h, /'Hide the ground' : 'Show the ground'/);
  assert.match(h, /full\.setAttribute\('aria-label', label\)/,
    'the glyph must be relabelled with the state, or a screen reader hears the wrong action');
});

test('the ground is on by default, and reaches the renderer', () => {
  assert.match(appJs, /let skyGround = true;/);
  assert.match(appJs, /ground: skyGround,/);
  assert.match(skydraw, /drawGround\(ctx, o\.ground !== false/,
    'an old caller that passes nothing must still get the ground');
});

test('the full-screen button lives with the zoom controls', () => {
  const cluster = html.slice(html.indexOf('class="full-zoom"'), html.indexOf('class="full-pan"'));
  assert.match(cluster, /id="fullGround"/, 'the corner every thumb already knows');
});
