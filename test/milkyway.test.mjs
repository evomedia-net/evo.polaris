// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  texCoord, galacticBasis, toGalactic, pickDivisor, createMilkyWay,
  CREDIT, SOURCE_URL, TINT,
} from '../site/src/milkyway.js';
import {
  galacticToEquatorial, equatorialToVector, altAzToVector, basisFromAim,
  screenToVector, focalLength,
} from '../site/src/skyview.js';

// THE MILKY WAY AS A PHOTOGRAPH, PROJECTED INTO THE SKY.
//
// Two renderers draw one picture -- a fragment shader on the GPU, and the
// same arithmetic per pixel in JavaScript at reduced resolution for the ~3%
// of browsers without WebGL. Everything that can be checked without a
// browser is checked here: the coordinate chain, the texture mapping, the
// handedness that was measured against the Magellanic Clouds, the adaptive
// resolution, the fallback contract, and the credit the licence requires.
//
// What cannot be run here is the GPU. The shader is a transcription of
// screenToVector(), and the JavaScript path IS screenToVector(), so the test
// that matters most is that the two agree with each other and with the
// stars -- and that one CAN run: it compares the JS renderer's arithmetic
// against the star pipeline for the same direction.

const src = readFileSync(
  fileURLToPath(new URL('../site/src/milkyway.js', import.meta.url)), 'utf8');
const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const skydraw = readFileSync(
  fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
const sw = readFileSync(
  fileURLToPath(new URL('../site/sw.js', import.meta.url)), 'utf8');

const DEG = Math.PI / 180;
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

// --- the texture mapping ---------------------------------------------------

test('the galactic centre is the middle of the texture, and longitude runs leftward', () => {
  // Measured in build-milkyway.py: the LMC lands on a bright cloud only when
  // l increases LEFTWARD. So l = +10 must be to the LEFT of centre (u < 0.5).
  assert.equal(texCoord(0, 0).u, 0.5);
  assert.equal(texCoord(0, 0).v, 0.5);
  assert.ok(texCoord(10 * DEG, 0).u < 0.5, 'l=+10 must sit left of centre');
  assert.ok(texCoord(-10 * DEG, 0).u > 0.5, 'l=-10 must sit right of centre');
  // Latitude is up: the north galactic pole is the top row.
  close(texCoord(0, 90 * DEG).v, 0, 1e-12, 'b=+90 is the top');
  close(texCoord(0, -90 * DEG).v, 1, 1e-12, 'b=-90 is the bottom');
});

test('longitude wraps, so the anticentre is one edge and not a seam in the middle', () => {
  close(texCoord(180 * DEG, 0).u, 0, 1e-12, 'l=180 is the left edge');
  close(texCoord(-180 * DEG, 0).u, 0, 1e-12, 'and also the right edge, same place');
  // Just either side of the wrap lands just either side of the edge.
  assert.ok(texCoord(179 * DEG, 0).u < 0.01);
  assert.ok(texCoord(-179 * DEG, 0).u > 0.99);
});

test('the Magellanic Clouds land where the prep script found them', () => {
  // The exact check the handedness was settled with, expressed in texture
  // space: on a 6000-wide source the LMC was at x=4325, i.e. u = 0.72.
  const { u, v } = texCoord(280.5 * DEG, -32.9 * DEG);
  close(u, 4325 / 6000, 0.002, 'LMC u');
  close(v, 2048 / 3000, 0.002, 'LMC v');
});

// --- the coordinate chain ----------------------------------------------------

test('the galactic axes are orthonormal, whatever the time and place', () => {
  for (const [lst, lat] of [[0, 30], [13.7, -45], [23.9, 89], [6, 0]]) {
    const { gx, gy, gz } = galacticBasis(lst, lat);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    close(dot(gx, gx), 1, 1e-9, 'gx unit'); close(dot(gy, gy), 1, 1e-9, 'gy unit');
    close(dot(gz, gz), 1, 1e-9, 'gz unit');
    close(dot(gx, gy), 0, 1e-9, 'gx.gy'); close(dot(gx, gz), 0, 1e-9, 'gx.gz');
    close(dot(gy, gz), 0, 1e-9, 'gy.gz');
  }
});

test('a direction goes to galactic and back through the same pipeline as the stars', () => {
  // Take a point in galactic coordinates, push it through the STAR pipeline
  // (galacticToEquatorial -> equatorialToVector), then ask toGalactic where
  // it is. It must say where it started. This is the guarantee that the band
  // sits exactly on the stars: one astronomy, not two copies of it.
  const lst = 9.25, lat = 30.06;
  const G = galacticBasis(lst, lat);
  for (const [l, b] of [[0, 0], [90, 0], [180, 0], [270, 0], [45, 30], [300, -60], [10, 88]]) {
    const { ra, dec } = galacticToEquatorial(l, b);
    const v = equatorialToVector(ra, dec, lst, lat);
    const back = toGalactic(v, G);
    const dl = ((back.l / DEG - l + 540) % 360) - 180;
    close(dl, 0, 1e-6, `l round trip at (${l},${b})`);
    close(back.b / DEG, b, 1e-6, `b round trip at (${l},${b})`);
  }
});

test('precession is applied, as it is for the stars', () => {
  // The galactic frame is defined in J2000. Feeding the same precession
  // matrix the stars use must move the axes; leaving it out must not.
  const P = [[1, 0.001, 0], [-0.001, 1, 0], [0, 0, 1]]; // a small rotation
  const a = galacticBasis(5, 40, null);
  const b = galacticBasis(5, 40, P);
  const moved = Math.hypot(a.gx[0] - b.gx[0], a.gx[1] - b.gx[1], a.gx[2] - b.gx[2]);
  assert.ok(moved > 1e-5, 'the precession matrix must reach the galactic axes');
});

test('the JavaScript renderer uses the exact inverse projection the tap and drag use', () => {
  // The pixel loop in drawCanvas re-derives screenToVector inline for speed.
  // Inline copies drift, so this pins that for a sample of screen points the
  // inline arithmetic (reproduced here from the source) matches the function.
  const basis = basisFromAim(123, 41);
  const focal = focalLength(900, 65);
  const { right, up, forward } = basis;
  for (const [dx, dy] of [[0, 0], [300, -200], [-449, 299], [10, 10]]) {
    const ref = screenToVector(dx, dy, basis, focal);
    const a = dx / focal, b = -dy / focal;
    const vx = forward[0] + a * right[0] + b * up[0];
    const vy = forward[1] + a * right[1] + b * up[1];
    const vz = forward[2] + a * right[2] + b * up[2];
    const n = Math.hypot(vx, vy, vz);
    close(vx / n, ref[0], 1e-12, 'x'); close(vy / n, ref[1], 1e-12, 'y'); close(vz / n, ref[2], 1e-12, 'z');
  }
  // And the source really is that arithmetic, in both renderers.
  assert.match(src, /const vx = forward\[0\] \+ a \* right\[0\] \+ b \* up\[0\];/);
  assert.match(src, /vec3 v = normalize\(u_forward \+ a \* u_right \+ b \* u_up\);/);
  assert.match(src, /float b = -dy \/ u_focal;/, 'the shader must flip y exactly as screenToVector does');
});

test('the shader flips y, because gl_FragCoord counts from the bottom', () => {
  assert.match(src, /\(u_size\.y - gl_FragCoord\.y\)/,
    'without the flip the sky is drawn upside down against the stars');
});

// --- the adaptive fallback ---------------------------------------------------

test('the fallback coarsens when a pass overruns and refines when it has room', () => {
  assert.equal(pickDivisor(40, 4), 8, 'a 40ms pass on a 12ms budget must halve the resolution');
  assert.equal(pickDivisor(40, 8), 8, 'but never past the cap');
  assert.equal(pickDivisor(2, 4), 2, 'a 2ms pass has room to double the resolution');
  assert.equal(pickDivisor(2, 2), 2, 'but never past the floor');
  assert.equal(pickDivisor(10, 4), 4, 'within budget: leave it alone');
});

test('the fallback samples a quarter-size copy, not the full texture', () => {
  // Rendering at a fraction of the screen from a 4096-wide strip would be
  // memory spent on detail it can never show. Half a megabyte, not eight.
  assert.match(src, /lumW = 1024; lumH = 512;/);
});

test('the fallback reuses its picture when nothing has moved', () => {
  assert.match(src, /if \(key !== lastKey\) \{/,
    'in Manual Mode nothing moves between presses; re-rendering every frame there is waste');
});

// --- the fallback contract ---------------------------------------------------

test('draw() declines rather than throws, so the blobs can take over', async () => {
  // No document, no Image: the layer must still construct, report "none",
  // and return false from draw() -- never throw into the frame loop.
  const layer = createMilkyWay({
    doc: null,
    makeImage: () => ({ set src(_) { setTimeout(() => this.onerror && this.onerror(), 0); } }),
  });
  assert.equal(await layer.ready, false);
  assert.equal(layer.mode, 'none');
  assert.equal(layer.draw(null, {}), false);
});

test('a lost WebGL context is a decline, not a blank sky', () => {
  assert.match(src, /addEventListener\('webglcontextlost'/, 'the loss must be caught');
  assert.match(src, /e\.preventDefault\(\);/, 'and restoration requested, or the browser never tries');
  assert.match(src, /addEventListener\('webglcontextrestored'/, 'and acted on when it comes back');
  assert.match(src, /if \(layer\.lost\) return false;/,
    'while lost, draw() must say no so the procedural band is drawn instead');
});

test('the app keeps the procedural band as what draw() falls back to', () => {
  assert.match(skydraw, /o\.milkyLayer\.draw\(ctx/, 'the renderer must try the photograph first');
  assert.match(skydraw, /else if \(o\.milkyWay && o\.milkyWay\.length\)/,
    'and keep the blobs for when it declines');
  assert.match(appJs, /milkyWay = buildMilkyWay\(/, 'the blobs must still be built');
});

test('the texture is precached, or offline has no Milky Way', () => {
  assert.match(sw, /'\.\/src\/data\/milkyway\.webp'/);
});

test('the fallback can be asked for, so it can be looked at on any device', () => {
  assert.match(appJs, /nogl/, '?nogl=1 must force the canvas path');
});

// --- the credit --------------------------------------------------------------

test('the credit is the one ESO asks for, and links to the source', () => {
  assert.equal(CREDIT, 'ESO/S. Brunier');
  assert.match(SOURCE_URL, /eso\.org\/public\/images\/eso0932a/);
});

test('the credit is on the picture, in full screen too', () => {
  // ESO's terms: "cannot be hidden or separated from the image". Full screen
  // IS the image, so a credit only under the windowed view would leave the
  // picture on screen with its credit nowhere. The legend plate is drawn over
  // the map in both modes.
  assert.match(html, /id="legMilky"/, 'the legend must carry the credit row');
  const row = html.slice(html.indexOf('id="legMilky"'), html.indexOf('id="legMilky"') + 300);
  // A non-breaking space between the initial and the surname, so the credit
  // never wraps mid-name on a narrow plate. The wording is the same.
  assert.match(row, /ESO\/S\.(?: |&nbsp;)Brunier/, 'with the wording unaltered');
  // And under the map, with the link, where there is room for it.
  assert.match(html, /id="milkyCredit"/);
  const credit = html.slice(html.indexOf('id="milkyCredit"'), html.indexOf('id="milkyCredit"') + 400);
  assert.match(credit, /href="https:\/\/www\.eso\.org\/public\/images\/eso0932a\/"/);
  assert.match(credit, /ESO\/S\.(?: |&nbsp;)Brunier/);
});

test('the credit shows exactly when the photograph is drawn', () => {
  // Hidden with the Milky Way, and hidden when the blobs are what is on
  // screen: a credit for a picture that is not there is its own kind of
  // wrong.
  assert.match(appJs, /legMilky/);
  assert.match(appJs, /milkyCredit/);
  const fn = appJs.slice(appJs.indexOf('function updateLegend()'),
    appJs.indexOf('function updateLegend()') + 1600);
  assert.match(fn, /skyMilkyWay && milkyLayer\.mode !== 'none' && milkyLayer\.mode !== 'loading'/,
    'the credit must follow both the toggle and whether the image is actually in use');
});

test('night mode is a tint of the same picture, not a different one', () => {
  assert.equal(TINT.night.rgb[1], 0);
  assert.equal(TINT.night.rgb[2], 0);
  assert.ok(TINT.night.gain < TINT.day.gain, 'and dimmer, to keep dark adaptation');
});
