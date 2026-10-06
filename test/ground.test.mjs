// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView, groundCells } from '../site/src/skydraw.js';
import { altAzToVector, basisFromAim, focalLength, projectToScreen } from '../site/src/skyview.js';

// THE GROUND IS A WIREFRAME, AND YOU CAN SEE THROUGH IT.
//
// It began as "a wireframe earth or something that really shows the horizon
// and blocks everything below it", and was built as a solid fill that hid
// the sky beneath -- the way the real ground does. Seen on a phone, that
// cost more than the honesty was worth: half the picture goes black, and a
// set planet you are pointing at vanishes into it. So: "I would like the
// wireframe to be see-through. Just the wireframe is all you can see. I
// don't want the sphere to be opaque."
//
// What the wire still does is say exactly where the horizon is and which way
// is down, which was the point. What it no longer does is hide what is
// behind it -- so these tests pin the ABSENCE of a fill as deliberately as
// they once pinned its presence. The draw order stays: the ring, the pointer
// and the ISS marker come after the ground, so the wire never crosses them.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
const skydraw = readFileSync(
  fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');

const GROUND_WIRE = '#42597f';
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

const groundWires = (ops) => ops.filter((o) => o.op === 'stroke' && o.style === GROUND_WIRE);
/**
 * Fills made WHILE the ground was being drawn -- between its first wire and
 * its last. Scoped that way because the frame legitimately contains other
 * filled shapes (the off-screen pointer is a four-cornered arrow); what must
 * be empty is the ground's own span.
 */
const fillsWithinGround = (ops) => {
  const wires = ops.filter((o) => o.op === 'stroke' && o.style === GROUND_WIRE);
  if (!wires.length) return [];
  const first = ops.indexOf(wires[0]), last = ops.lastIndexOf(wires.at(-1));
  return ops.slice(first, last + 1).filter((o) => o.op === 'fill' || o.op === 'fillRect');
};
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

test('the ground is wire, and nothing behind it is painted over', () => {
  const ops = frame({ ground: true });
  const wires = groundWires(ops);
  assert.ok(wires.length > 50, `expected a wireframe hemisphere, got ${wires.length} strokes`);
  // THE POINT OF THE CHANGE. A star 20 degrees below the horizon is drawn --
  // and stays visible, because the ground fills nothing over it.
  assert.ok(starText(ops, 'Dubhe') >= 0, 'the star under the ground must still be drawn');
  assert.equal(fillsWithinGround(ops).length, 0,
    'the ground must fill nothing -- the sky shows through');
  // The wire stays below the horizon, where the ground is.
  const basis = basisFromAim(0, 0), focal = focalLength(W, 65);
  const horizonY = H / 2 + projectToScreen(altAzToVector(0, 0), basis, focal).y;
  for (const wire of wires) for (const [, y] of wire.pts) {
    assert.ok(y >= horizonY - 1, `a ground cell reached ${(horizonY - y).toFixed(0)}px above the horizon`);
  }
});

test('the ring and the pointer stay on top of the ground', () => {
  // A target that has set keeps its marker: the sky it is in is hidden, the
  // ring saying "it is here, under the ground" is not.
  const ops = frame({ ground: true, targetAlt: -30 });
  const wires = groundWires(ops);
  const lastGround = ops.lastIndexOf(wires.at(-1));
  const ring = ringIndex(ops);
  assert.ok(ring > lastGround, 'the ring must be drawn after the ground, so the wire never crosses it');
});

test('with the ground off, the wire goes and the old marks return', () => {
  const ops = frame({ ground: false });
  assert.equal(groundWires(ops).length, 0, 'no wireframe when it is off');
  assert.ok(starText(ops, 'Dubhe') >= 0, 'the set star is drawn either way');
});

test('the cardinal points sit on the ground, not under it', () => {
  const ops = frame({ ground: true });
  const wires = groundWires(ops);
  const lastGround = ops.lastIndexOf(wires.at(-1));
  const north = ops.findIndex((o) => o.op === 'text' && o.text === 'N');
  assert.ok(north > lastGround, 'N must be drawn after the ground, so the wire does not cross it');
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
  for (const f of groundWires(ctx.ops)) for (const [x, y] of f.pts) {
    assert.ok(Math.abs(x) < W * 8 && Math.abs(y) < H * 8, `a ground corner at (${x.toFixed(0)}, ${y.toFixed(0)})`);
  }
});

// --- the controls ---------------------------------------------------------------

test('one switch, two places, and the words say what pressing does', () => {
  assert.match(html, /id="skyGround" class="big-btn">Hide the ground</,
    'the Visual Settings button must follow the button rule');
  // IN FULL SCREEN IT IS "HORIZON" -- the word is written under the glyph,
  // and WCAG 2.5.3 wants the accessible name to contain what is written, or
  // "tap Horizon" by voice misses the button.
  assert.match(html, /id="fullGround"[^>]*aria-label="Hide the horizon"/,
    'the name must contain the word printed on the button');
  assert.match(html, /id="fullGround"[\s\S]{0,200}?Horizon</,
    'and the word must be there to read');
  assert.match(appJs, /\$\('fullGround'\)\.onclick = \(\) => \$\('skyGround'\)\.click\(\);/,
    'the full-screen button must press the real one, not keep its own state');
  const h = appJs.slice(appJs.indexOf("$('skyGround').onclick"), appJs.indexOf("$('skyGround').onclick") + 800);
  assert.match(h, /'Hide the horizon' : 'Show the horizon'/);
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
