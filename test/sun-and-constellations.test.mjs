// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView, SUN_MIN_ALT } from '../site/src/skydraw.js';
import { altAzToVector, figureCentre, vectorToAltAz } from '../site/src/skyview.js';
import { CONSTELLATIONS } from '../site/src/data/constellations.js';

// THE SUN, ALWAYS POINTED AT; THE CONSTELLATIONS, ONE BUTTON APART.
//
// "It would be nice to have a constellation button that snaps to each one
// with its name. And it would be nice to have where the sun is ... it should
// always point at the sun, even during the day it would be above the
// horizon."
//
// The Sun is a body like the Moon now: computed of date, drawn as a disc
// while any of it is above the horizon -- this view is used in daylight, for
// finding the pole before dark -- and targetable always, so below the
// horizon the ring says it has set and the arrow points down at it. The
// constellations get a cycling button like the planets, the ring on the
// middle of each figure and its name as the caption.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');

const DEG = Math.PI / 180;

function stubCtx() {
  const texts = [], arcs = [];
  return {
    texts, arcs,
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, stroke() {}, moveTo() {}, lineTo() {},
    fill() {}, clearRect() {}, fillRect() {}, setLineDash() {}, clip() {},
    arc(x, y, r) { arcs.push({ x, y, r, style: String(this.fillStyle) }); },
    ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t) { texts.push(String(t)); }, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage() {},
  };
}

/** One frame with the Sun at a given altitude, straight ahead. */
function frameWithSunAt(alt, targetName = 'Target') {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null, planets: null,
    moon: null, iss: null,
    sun: { alt, az: 180, v: altAzToVector(alt, 180) },
    aim: { az: 180, alt: Math.max(alt, 5) },
    alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: alt, targetAz: 180, targetName, reticleR: 28,
    w: 900, h: 600, fov: 65, night: false, ground: false,
  });
  return ctx;
}

// --- the Sun ------------------------------------------------------------------------

test('the Sun is drawn while any of it is above the horizon, and not after', () => {
  assert.equal(SUN_MIN_ALT, -0.8, 'half a degree of disc plus half a degree of refraction');
  assert.ok(frameWithSunAt(30).texts.includes('Sun'), 'a daytime Sun is drawn and named');
  assert.ok(frameWithSunAt(-0.5).texts.includes('Sun'), 'a setting Sun, centre just below, is still in view');
  assert.ok(!frameWithSunAt(-5).texts.includes('Sun'), 'a Sun five degrees down is gone');
});

test('a Sun under the ring is named once, by the ring', () => {
  const texts = frameWithSunAt(30, 'Sun');
  assert.equal(texts.texts.filter((t) => t === 'Sun').length, 1);
});

test('the app builds the Sun of date, like the Moon, and hands it to the renderer', () => {
  assert.match(appJs, /const sunEq = sunEquatorial\(appTime\(\)\);/,
    'the Sun is placed for the time being shown, planned night included');
  assert.match(appJs, /\{ ra: sunEq\.ra, dec: sunEq\.dec, frame: 'date', isSun: true \}/,
    'of date, so it is not precessed a second time -- the Moon\'s flag, for the Moon\'s reason');
  assert.match(appJs, /sun: skySunBody,/);
});

test('the Sun is a target, always, and says when it has set', () => {
  assert.match(html, /id="tgtSun" class="map-btn tgt-btn" aria-pressed="false">Sun</);
  assert.match(appJs, /\$\('tgtSun'\)\.onclick = \(\) => goToTarget\(guideTarget === 'sun' \? 'none' : 'sun'\);/,
    'pressing the Sun points at it; pressing again lets go');
  const aim = appJs.slice(appJs.indexOf('function aimTarget('), appJs.indexOf('function aimAtPole('));
  assert.match(aim, /if \(what === 'sun'\)/);
  assert.match(aim, /name: 'Sun'/);
  const painted = appJs.slice(appJs.indexOf('function targetIsPainted('), appJs.indexOf('function aimAtPole('));
  assert.match(painted, /if \(what === 'sun'\) return t\.alt > SUN_MIN_ALT;/,
    'below the horizon the caption must say it has set, from the same gate the disc uses');
  assert.match(appJs, /\['tgtSun', guideTarget === 'sun'\]/, 'aria-pressed must carry the state');
});

// --- the constellations ---------------------------------------------------------------

test('the centre of a figure is inside it, from each star once', () => {
  // Three stars in a triangle around due south at 40 degrees up; two lines
  // that share a star. The centre must be the mean of THREE directions, not
  // four -- the shared star counted once.
  const v = (alt, az) => altAzToVector(alt, az);
  const byHr = new Map([[1, v(50, 170)], [2, v(50, 190)], [3, v(30, 180)]]);
  const c = figureCentre([[1, 2], [2, 3]], byHr);
  const { alt, az } = vectorToAltAz(c);
  assert.ok(Math.abs(az - 180) < 1e-6, `centre az ${az}`);
  assert.ok(alt > 40 && alt < 46, `centre alt ${alt}: the mean of 50, 50 and 30 leans up, not the mean of four`);
  assert.equal(figureCentre([[9, 9]], byHr), null, 'a figure with no known stars has no centre');
});

test('every shipped figure has a centre that is inside the sky it is drawn from', () => {
  // Each constellation's stars are given directions on a sphere; the mean
  // must be a unit vector pointing somewhere near them, never the zero
  // vector a figure spread across the whole sky would collapse to. None of
  // the shipped figures is that spread out, and this holds it so.
  const hrs = new Set();
  for (const k of Object.keys(CONSTELLATIONS)) for (const [a, b] of CONSTELLATIONS[k].lines) { hrs.add(a); hrs.add(b); }
  // Deterministic fake directions: spread the catalogue over the sky, but
  // keep each figure's stars within a patch, which is what real ones do.
  const byHr = new Map();
  let i = 0;
  for (const k of Object.keys(CONSTELLATIONS)) {
    const baseAz = (i * 37) % 360, baseAlt = 20 + (i * 13) % 50; i += 1;
    let j = 0;
    for (const [a, b] of CONSTELLATIONS[k].lines) for (const hr of [a, b]) {
      if (!byHr.has(hr)) { byHr.set(hr, altAzToVector(baseAlt + (j % 5), baseAz + (j % 7))); j += 1; }
    }
  }
  for (const k of Object.keys(CONSTELLATIONS)) {
    const c = figureCentre(CONSTELLATIONS[k].lines, byHr);
    assert.ok(c, `${k} has no centre`);
    assert.ok(Math.abs(Math.hypot(...c) - 1) < 1e-9, `${k}'s centre is not a unit vector`);
  }
});

test('one button walks every figure by name, then lets go, then starts again', () => {
  assert.match(html, /id="tgtConst" class="map-btn tgt-btn" aria-pressed="false"\s+aria-label="Point at the next constellation">Constellations</);
  assert.match(appJs, /const CONST_KEYS = Object\.keys\(CONSTELLATIONS\);/,
    'the cycle reads the shipped figures rather than keeping a second list');
  const h = appJs.slice(appJs.indexOf("$('tgtConst').onclick"), appJs.indexOf('// The sky turns a quarter'));
  // The walk itself is walk.js's nextStop, whose stop past the end is
  // "nothing"; test/up-only.test.mjs walks it.
  assert.match(h, /constStep = nextStop\(constStep, CONST_KEYS\.length,/, 'the length is where nothing lives');
  assert.match(h, /'const:' \+ CONST_KEYS\[constStep\] : 'none'/);
  assert.match(h, /goToTarget\(next, \{ keepCycle: true \}\)/, 'it travels there, like everything else');
  const aim = appJs.slice(appJs.indexOf('function aimTarget('), appJs.indexOf('function aimAtPole('));
  assert.match(aim, /if \(what\.startsWith\('const:'\)\)/);
  assert.match(aim, /name: fig\.name/, 'the caption is the figure\'s own name');
  assert.match(aim, /figureCentre\(fig\.lines, byHr\)/, 'the ring goes on the middle of the figure');
});

test('the two cycles do not tangle', () => {
  // Picking a planet leaves the constellation walk, and vice versa, and any
  // other target leaves both -- otherwise the next press of a cycle button
  // resumes from the middle of a walk that was abandoned.
  assert.match(appJs, /if \(!keepCycle\) \{ planetStep = -1; constStep = -1; galaxyStep = -1; \}/);
  const planets = appJs.slice(appJs.indexOf("$('tgtPlanets').onclick"), appJs.indexOf("$('tgtConst').onclick"));
  assert.match(planets, /constStep = -1;/);
  const consts = appJs.slice(appJs.indexOf("$('tgtConst').onclick"), appJs.indexOf('// The sky turns a quarter'));
  assert.match(consts, /planetStep = -1;/);
  assert.match(appJs, /\['tgtConst', guideTarget\.startsWith\('const:'\)\]/, 'aria-pressed follows the walk');
});

test('a figure whose middle is under the ground says so', () => {
  const painted = appJs.slice(appJs.indexOf('function targetIsPainted('), appJs.indexOf('function aimAtPole('));
  assert.match(painted, /if \(what\.startsWith\('const:'\)\) return t\.alt > 0;/);
});
