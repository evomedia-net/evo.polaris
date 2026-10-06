// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planetPosition, PLANET_NAMES, ringOpening } from '../site/src/planets.js';
import { ROWS, CREDIT } from '../site/src/planet-art.js';

// THE PLANETS AS LITTLE WORLDS.
//
// "can we now put textures on each planet?" A planet was a dot sized from
// its magnitude -- correct, and indistinguishable from ten thousand other
// dots. What makes Jupiter recognisable is its belts.
//
// The drawing itself needs a canvas and is checked in a browser. What is
// checked here is everything that can be wrong WITHOUT a canvas: the ring
// geometry, which is real astronomy; the atlas agreeing with the code that
// indexes it; and the fallback that keeps a planet on screen when the
// texture cannot be drawn.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const skydraw = readFileSync(fileURLToPath(new URL('src/skydraw.js', root)), 'utf8');
const art = readFileSync(fileURLToPath(new URL('src/planet-art.js', root)), 'utf8');
const sw = readFileSync(fileURLToPath(new URL('sw.js', root)), 'utf8');

const DEG = Math.PI / 180;
const openingAt = (iso) => ringOpening(planetPosition('Saturn', new Date(iso))) / DEG;

// --- the rings, against the sky itself ----------------------------------------------

test("Saturn's rings close to edge-on at the 2025 crossing", () => {
  // THE INDEPENDENT CHECK. Nothing in this code knows the date of a ring
  // plane crossing; it falls out of the geometry. The rings passed edge-on
  // on 2025 March 23, an event published years in advance -- so landing
  // within a fraction of a degree of zero there, and nowhere near zero at
  // other times, validates the pole direction, the sign and the formula at
  // once. This is the Southern Cross rule of the ring system.
  assert.ok(Math.abs(openingAt('2025-03-23T00:00:00Z')) < 0.3,
    `edge-on at the crossing, got ${openingAt('2025-03-23T00:00:00Z').toFixed(2)}°`);
});

test('and open toward their maximum midway between crossings', () => {
  // Crossings come about every 15 years; the widest opening is near the
  // midpoint, and never exceeds about 27 degrees because that is the tilt
  // of Saturn's axis to its orbit.
  const wide2017 = openingAt('2017-06-01T00:00:00Z');
  const wide2032 = openingAt('2032-06-01T00:00:00Z');
  assert.ok(wide2017 > 24 && wide2017 < 27.5, `2017 opening ${wide2017.toFixed(2)}°`);
  assert.ok(wide2032 < -24 && wide2032 > -27.5, `2032 opening ${wide2032.toFixed(2)}°`);
  // Opposite faces either side of a crossing: the sign must flip, or the
  // rings would be drawn from the same side for ever.
  assert.ok(wide2017 * wide2032 < 0, 'the two are opposite faces');
});

test('the opening never exceeds the tilt of the ring plane', () => {
  // Sampled across a full orbit: nothing may exceed ~27 degrees, and the
  // value must stay finite -- an asin fed a number a hair over 1 gives NaN,
  // which would silently stop the rings being drawn at all.
  for (let y = 2000; y <= 2032; y += 1) {
    const b = openingAt(`${y}-01-01T00:00:00Z`);
    assert.ok(Number.isFinite(b), `not finite at ${y}`);
    assert.ok(Math.abs(b) <= 27.5, `${b.toFixed(2)}° at ${y} exceeds the axial tilt`);
  }
});

// --- the atlas and the code that indexes it -------------------------------------------

test('every textured row is a planet the app actually draws', () => {
  // The renderer finds a row by indexOf(name). A row for a name the app
  // never draws is dead weight in a file every phone downloads before it is
  // needed; a name the app draws with no row simply falls back to a dot.
  for (const name of ROWS) {
    assert.ok(PLANET_NAMES.includes(name), `${name} has a texture but is not drawn`);
  }
  // Pluto is the deliberate omission: Solar System Scope publishes no map,
  // the New Horizons one covers a single hemisphere, and at magnitude 14 it
  // is never visible to the eye anyway.
  assert.ok(!ROWS.includes('Pluto'), 'Pluto is deliberately textureless');
  assert.ok(PLANET_NAMES.includes('Pluto'), 'but it is still drawn, as a dot');
});

test('the atlas ships, and is small enough to precache', () => {
  // This app works with the radio off, so the atlas is downloaded before it
  // is ever needed. The whole point of 128x64 tiles is that seven planets
  // cost a few kilobytes rather than a few megabytes.
  const f = fileURLToPath(new URL('src/data/planets.webp', root));
  const kb = statSync(f).size / 1024;
  assert.ok(kb > 1, 'the atlas is missing or empty');
  assert.ok(kb < 40, `${kb.toFixed(1)} KB is too much to precache for seven discs`);
  assert.match(sw, /'\.\/src\/data\/planets\.webp'/, 'and it must be in the precache list');
  assert.match(sw, /'\.\/src\/planet-art\.js'/, 'along with the module that reads it');
});

// --- never worse than a dot -------------------------------------------------------------

test('a planet is still drawn when the texture cannot be', () => {
  // The layer answers false for: no image yet, no row, a radius too small to
  // be worth it, or anything that threw. Every one of those must leave the
  // old dot behind rather than an empty patch of sky.
  assert.match(art, /if \(!img \|\| r < 3\) return false;/);
  assert.match(art, /if \(row < 0\) return false;/);
  assert.match(art, /catch \{ return false; \}/);
  const loop = skydraw.slice(skydraw.indexOf('if (o.planets) {'), skydraw.indexOf('if (o.moon'));
  assert.match(loop, /if \(!painted\) \{/, 'the dot must be the fallback');
  assert.match(loop, /ctx\.arc\(x, y, dot, 0, Math\.PI \* 2\);/);
});

test('the phase and the lit side come from one implementation, not two', () => {
  // A mirrored crescent is wrong in a way people notice instantly. The Moon
  // and the planets measure north and east from the same projection through
  // the same function -- two copies would be two chances to get the
  // handedness backwards, and only one of them would ever be caught.
  assert.match(skydraw, /export function limbAngleOnScreen\(body, q, basis, focal\)/);
  const moon = skydraw.slice(skydraw.indexOf('if (o.moon) {'), skydraw.indexOf('moonFace(ctx'));
  assert.match(moon, /limbAngleOnScreen\(o\.moon, q, basis, focal\)/, 'the Moon uses it');
  const loop = skydraw.slice(skydraw.indexOf('if (o.planets) {'), skydraw.indexOf('if (o.moon'));
  assert.match(loop, /limbAngleOnScreen\(p, q, basis, focal\)/, 'and so do the planets');
  // The illuminated fraction is the phase angle the magnitude already uses.
  assert.match(appJs, /illuminated: \(1 \+ Math\.cos\(p\.phaseAngle \* Math\.PI \/ 180\)\) \/ 2/);
});

test('the credit rides with the picture, like the Milky Way’s', () => {
  // CC BY 4.0, the same licence the panorama ships under, so the credit is
  // part of the UI rather than a line in a file nobody opens -- and it is
  // shown only while the textures are what is on screen.
  assert.equal(CREDIT, 'Planets: Solar System Scope');
  assert.match(appJs, /const textured = skyShowPlanets && planetArt\.mode === 'texture';/);
  assert.match(appJs, /planetCredit\.hidden = !textured;/);
});
