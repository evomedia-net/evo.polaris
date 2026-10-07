// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView } from '../site/src/skydraw.js';
import { altAzToVector, starRadius } from '../site/src/skyview.js';

// STARS CAN BE MADE BRIGHTER OR DIMMER, AND IT IS REMEMBERED.
//
// "stars are very hard to see -- I'd like a set of -/+ Star Dimmer buttons
// ... below or above [<--] and [-->] nav buttons". One setting scales every
// star's disc (and glow) together, in seven steps around the size the app
// always drew; the buttons sit in the full-screen pad's empty bottom corners
// and in Visual Settings, which is the pair Auto Mode can reach.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const app = read('../site/src/app.js');
const html = read('../site/index.html');
const css = read('../site/src/style.css');

function starArcs(starGain, dpr) {
  const arcs = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    globalCompositeOperation: '', filter: '', lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {}, closePath() {},
    stroke() {}, moveTo() {}, lineTo() {}, fill() {}, clearRect() {}, fillRect() {}, setLineDash() {},
    clip() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, fillText() {}, strokeText() {},
    arc(x, y, r) { arcs.push(r); },
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; },
  };
  drawSkyView(ctx, {
    sky: [{ v: altAzToVector(20, 10), mag: 3.0, hr: 1, bv: 0.6 }],
    constellations: null, milkyWay: null, tracks: null, planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 20 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 20, targetAz: 0, targetName: 'Polaris', reticleR: 28,
    w: 900, h: 600, fov: 65, night: false, ground: false, starGain, dpr,
  });
  return arcs;
}

test('the setting scales the star discs, and leaves the normal size where it was', () => {
  const plain = starRadius(3.0);
  assert.ok(starArcs(undefined).includes(plain), 'no setting draws the size the app always drew');
  assert.ok(starArcs(1).includes(plain));
  assert.ok(starArcs(2).includes(plain * 2), 'x2 doubles the disc');
  assert.ok(starArcs(0.6).includes(plain * 0.6));
});

test('seven steps, the normal one in the middle, remembered, stopping at each end', () => {
  const m = app.match(/const STAR_GAINS = \[([^\]]+)\];/);
  assert.ok(m, 'STAR_GAINS is gone');
  const gains = m[1].split(',').map(Number);
  assert.equal(gains.length, 7);
  assert.deepEqual([...gains].sort((a, b) => a - b), gains, 'ascending');
  assert.ok(gains.indexOf(1) > 0 && gains.indexOf(1) < gains.length - 1, 'room to go both ways from normal');
  assert.match(app, /store\.get\('starstep', STAR_NORMAL\)/, 'remembered between visits');
  assert.match(app, /store\.set\('starstep', starStep\)/);
  assert.match(app, /\$\(id\)\.disabled = starStep <= 0;/);
  assert.match(app, /\$\(id\)\.disabled = starStep >= STAR_GAINS\.length - 1;/);
  assert.match(app, /starGain: STAR_GAINS\[starStep\],/);
});

test('the buttons: Visual Settings for both modes, and the pad corners in full screen', () => {
  assert.match(html, /<button id="skyStarBright" class="big-btn">Make the stars brighter<\/button>/);
  assert.match(html, /<button id="skyStarDim" class="big-btn">Make the stars dimmer<\/button>/);
  assert.match(html, /id="fullStarDim" class="map-btn map-pan-btn pad-dim tagged" aria-label="Make the stars dimmer"/);
  assert.match(html, /id="fullStarBright" class="map-btn map-pan-btn pad-bright tagged" aria-label="Make the stars brighter"/);
  // In the full-screen pad, and in its two empty corners, so the pad keeps
  // its size: three columns, three rows, the same as before.
  const pad = html.slice(html.indexOf('<div class="full-pan" id="fullPan"'), html.indexOf('</div>', html.indexOf('<div class="full-pan" id="fullPan"')));
  assert.ok(pad.includes('id="fullStarDim"') && pad.includes('id="fullStarBright"'));
  assert.match(css, /grid-template-areas: "\. up \." "left mid right" "dim down bright";/);
  assert.match(css, /\.pad-dim \{ grid-area: dim; \} \.pad-bright \{ grid-area: bright; \}/);
});

test('a star is the same size on screen at any pixel density (#204)', () => {
  // The canvas is drawn at the screen's density, up to 2x, so a disc in
  // canvas pixels was half-size on a phone. Density now scales it, and with
  // the brightness setting on top.
  const plain = starRadius(3.0);
  assert.ok(starArcs(1, 2).includes(plain * 2), 'a 2x screen draws the disc twice as many canvas pixels across');
  assert.ok(starArcs(1.3, 2).includes(plain * 1.3 * 2));
  assert.match(app, /dpr: Math\.min\(window\.devicePixelRatio \|\| 1, 2\),/, 'the same capped density the canvas is sized with');
});
