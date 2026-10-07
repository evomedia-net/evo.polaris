// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView } from '../site/src/skydraw.js';

// THE TARGET RING IS THE SAME SIZE ON SCREEN, ALWAYS.
//
// It marks what you are aligning to. A reticle that changes size is one you
// have to re-read every time it does, and on a phone held up in the dark that
// is a real cost. It has now been got wrong twice, in opposite directions:
//
//   1. It was briefly an ANGULAR size -- a fixed patch of sky -- so it grew
//      and shrank with the zoom.
//   2. It was then h/14, which is the same as min(w,h)/14 right up until the
//      canvas stops being wider than it is tall. Full screen in PORTRAIT it
//      is the long side, and the ring went from 14% of the narrow side of the
//      view to 31% of it -- reported as "the green ring is really big in full
//      screen mode". The app fills the screen by itself when the phone turns,
//      so the ring changed size as you rotated.
//
// So the test drives the real renderer at both shapes and compares, rather
// than reading the source for whichever formula is currently in fashion.

const skydraw = readFileSync(
  fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');
const appSrc = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const ACCENT = '#7CFFB2';

/** A canvas context that records the arcs and text it was asked to draw. */
function stubCtx() {
  const arcs = [];
  const fills = [];
  return {
    arcs, fills,
    // state the renderer sets and reads back
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    path: [],
    beginPath() { this.path = []; }, closePath() {}, stroke() {},
    moveTo(x, y) { this.path.push([x, y]); },
    lineTo(x, y) { this.path.push([x, y]); },
    fill() { if (this.path.length >= 3) fills.push({ pts: this.path.slice(), style: this.fillStyle }); },
    clearRect() {}, fillRect() {}, setLineDash() {}, clip() {},
    arc(x, y, r) { arcs.push({ x, y, r, stroke: this.strokeStyle }); },
    ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
}

/** Render one frame and return the radius of the accent-stroked ring. */
function ringRadius(w, h, reticleR) {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null,
    planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 45 },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 45, targetAz: 0, targetName: 'Polaris',
    reticleR,
    w, h, fov: 65, night: false,
  });
  const ring = ctx.arcs.filter((a) => String(a.stroke).toLowerCase() === ACCENT.toLowerCase());
  assert.equal(ring.length, 1, `expected one accent ring, got ${ring.length}`);
  return ring[0].r;
}

test('the ring is the same size in every mode, not just every shape', () => {
  // THE THIRD TIME THIS SIZE HAS BEEN WRONG, and the first two fixes are why
  // the rule is now what it is. min(w, h) held the ring still when the phone
  // was TURNED, but not when the same view was made BIGGER: going full screen
  // grows the canvas, so the ring grew with it -- 71 CSS px windowed against
  // 114 full screen, measured on a 1280x800 desktop, reported as "it's very
  // large on pc in full screen" and "I want reticle same screen size in every
  // mode".
  //
  // So the ruler is no longer the canvas at all. The caller measures the
  // WINDOW, which going full screen does not change, and hands the radius in.
  // These are the same three canvases as before -- windowed, full screen
  // landscape, full screen portrait -- on one device, so one radius:
  const r = 28;
  const windowed = ringRadius(780, 520, r);
  const landscape = ringRadius(1688, 780, r);
  const portrait = ringRadius(780, 1688, r);
  assert.equal(windowed, r);
  assert.equal(landscape, r,
    `${landscape}px full screen against ${windowed}px windowed -- the ring `
    + 'still grows when the view does');
  assert.equal(portrait, landscape,
    'the ring changes size when the phone is turned');
});

test('the app measures the window for it, not the canvas', () => {
  // The canvas is the thing that changes between the two modes; the window is
  // the thing that does not. Keying it to the canvas is the bug, so this
  // pins WHAT is measured, not merely that something is passed.
  assert.match(appSrc, /reticleR: \(Math\.min\(window\.innerWidth, window\.innerHeight\)/,
    'the reticle must be sized from the viewport');
  assert.ok(!/reticleR:[^\n]*c\.(width|height)/.test(appSrc),
    'sizing it from the canvas is the bug this replaced');
  // The short side, so turning a phone does not resize it either -- which was
  // the SECOND of the three bugs, and must not be undone by fixing the third.
  assert.match(appSrc, /Math\.min\(window\.innerWidth, window\.innerHeight\)/);
});

test('the ring does not depend on the zoom either', () => {
  const ctx = (fov) => {
    const c = stubCtx();
    drawSkyView(c, {
      sky: [], constellations: null, milkyWay: null, tracks: null,
      planets: null, moon: null, iss: null,
      aim: { az: 0, alt: 45 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
      targetAlt: 45, targetAz: 0, targetName: 'Polaris',
      w: 780, h: 520, fov, night: false,
    });
    return c.arcs.find((a) => String(a.stroke).toLowerCase() === ACCENT.toLowerCase()).r;
  };
  assert.equal(ctx(10), ctx(65), 'the ring changed size with the field of view');
  assert.equal(ctx(65), ctx(170), 'the ring changed size with the field of view');
});

test('the short side is the ruler, and it is used everywhere', () => {
  // Every size drawn at a fixed scale on screen reads from one reference, so
  // the ring cannot drift away from the labels beside it.
  assert.match(skydraw, /const ref = Math\.min\(w, h\);/,
    'the single reference dimension is gone');
  const body = skydraw.slice(skydraw.indexOf('export function drawSkyView'),
    skydraw.indexOf('export function drawTrack'));
  const bareH = body.split('\n')
    .filter((l) => /\bh \/ \d/.test(l) && !/cy = h \/ 2/.test(l));
  assert.deepEqual(bareH, [],
    `these still measure against the canvas height instead of the short side:\n`
    + bareH.join('\n'));
});

test('the angular ring does not come back', () => {
  const block = skydraw.slice(skydraw.indexOf('// The target:'),
    skydraw.indexOf('// The ISS,'));
  assert.ok(!/RING_DEG|Math\.tan/.test(block),
    'the angular ring is back — see the note at the top of this file');
  const line = block.split('\n').find((l) => /const r =/.test(l));
  assert.ok(line && !line.includes('focal'),
    `the radius must not be derived from the focal length: ${line}`);
});

// --- the off-screen pointer --------------------------------------------------
//
// When the target is off the edge, this arrow is the ONLY thing on screen
// saying which way to turn. It was a flat triangle 24 device pixels long and,
// alone among everything drawn here, was never scaled -- about 12 CSS pixels
// on a phone at dpr 2. Reported as wanting to be "a bit bigger and a little
// more arrow looking".

/** The arrow's path, rendered with the target behind the viewer. */
function arrowPath(w, h) {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null,
    planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 45 },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    // Directly behind: guaranteed off screen, so the pointer is drawn.
    targetAlt: -20, targetAz: 180, targetName: 'Polaris',
    w, h, fov: 65, night: false,
  });
  const arrow = ctx.fills.filter(
    (f) => String(f.style).toLowerCase() === ACCENT.toLowerCase());
  assert.equal(arrow.length, 1, `expected one accent arrow, got ${arrow.length}`);
  return arrow[0].pts;
}

test('the pointer is an arrow, not a triangle', () => {
  // Four corners: tip, two swept-back corners, and the notch between them.
  // A plain triangle reads as a wedge that could be pointing either way.
  const pts = arrowPath(780, 1688);
  assert.equal(pts.length, 4,
    `an arrowhead has four corners including the notch, got ${pts.length}`);
  const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
  // Sorted, the two swept-back corners share the lowest x, the notch sits
  // between them and the tip, and the tip is furthest forward. (Indexing this
  // as xs[1] was wrong first time round: that is the SECOND back corner.)
  const [back, back2, notch, tip] = xs;
  assert.equal(back, back2, 'the two back corners must be level with each other');
  assert.ok(notch > back,
    'the tail must be notched inward, which is what makes it an arrow');
  assert.ok(notch < 0, 'the notch belongs behind the middle, not in front of it');
  assert.ok(tip > 0 && back < 0, 'the arrow must straddle its own origin');
  // And it must point somewhere: clearly longer than it is half-wide.
  const ys = pts.map((p) => p[1]);
  assert.ok((tip - back) > (Math.max(...ys) - Math.min(...ys)) * 0.9,
    'a pointer wider than it is long does not read as pointing');
});

test('the pointer grows with the view, like everything else does', () => {
  const small = arrowPath(780, 520);
  const big = arrowPath(1688, 1688);
  const len = (pts) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  assert.ok(len(big) > len(small),
    'the arrow is a fixed pixel size again — on a phone that is a speck');
  // And it is a real size, not the 12 CSS pixels it used to be.
  assert.ok(len(arrowPath(780, 1688)) >= 50,
    'the arrow is too small to find at a glance');
});
