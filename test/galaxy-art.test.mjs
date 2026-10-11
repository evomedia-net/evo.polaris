// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GALAXY_ART, GALAXY_TILE, GALAXY_COLS, GALAXY_CREDITS } from '../site/src/data/galaxy-art.js';
import { GALAXIES } from '../site/src/data/galaxies.js';

// THE GALAXIES AS PHOTOGRAPHS.
//
// Kelly chose them from candidates laid side by side: "go with B" -- natural
// colour, CC BY 4.0, from NOIRLab, ESO and ESA/Hubble. Thirteen pictures,
// one per galaxy except M 32 and M 110, which are inside the Andromeda
// picture (#267). Each hangs on the sky by four corners on its own tangent
// plane, worked out by scripts/build-galaxy-art.py from the AVM mapping
// inside each JPG, and drawn by the same layer as the constellation figures.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)));
const text = (p) => read(p).toString('utf8');
const appJs = text('../site/src/app.js');
const skydraw = text('../site/src/skydraw.js');
const sw = text('../site/sw.js');
const html = text('../site/index.html');
const readme = text('../README.md');

const vec = (ra, dec) => {
  const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
};
const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];

/** Where a sky direction meets a picture's plane, as (u, v) across its tile. */
function inTile(art, ra, dec) {
  const [tl, tr, , bl] = art.c;
  const ex = tr.map((v, i) => v - tl[i]), ey = bl.map((v, i) => v - tl[i]);
  const n = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const d = vec(ra, dec);
  const t = dot(tl, n) / dot(d, n);
  const p = d.map((v, i) => v * t - tl[i]);
  const A = dot(ex, ex), B = dot(ex, ey), C = dot(ey, ey), P = dot(p, ex), Q = dot(p, ey);
  const det = A * C - B * B;
  return [(C * P - B * Q) / det, (A * Q - B * P) / det];
}

/** A WebP's pixel size, from its header (VP8, VP8L or VP8X). */
function webpSize(buf) {
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)];
  }
  throw new Error(`not a WebP I can read: ${kind}`);
}

test('thirteen pictures, one per galaxy, and none for M 32 or M 110', () => {
  const keys = new Set(GALAXIES.map((g) => g.key));
  assert.equal(GALAXY_ART.length, 13);
  for (const a of GALAXY_ART) {
    assert.ok(keys.has(a.k), `${a.k} is not one of the app's galaxies`);
    assert.equal(a.c.length, 4, `${a.k} has four corners`);
  }
  const pictured = new Set(GALAXY_ART.map((a) => a.k));
  assert.ok(!pictured.has('m32') && !pictured.has('m110'), 'they would be drawn twice');
  assert.equal(new Set(GALAXY_ART.map((a) => a.i)).size, 13, 'one tile each');
});

test('the atlas is the size the data says, inside what a phone will make', () => {
  const [w, h] = webpSize(read('../site/src/data/galaxies.webp'));
  const rows = Math.ceil(GALAXY_ART.length / GALAXY_COLS);
  assert.equal(w, GALAXY_COLS * GALAXY_TILE);
  assert.equal(h, rows * GALAXY_TILE);
  assert.ok(w <= 4096 && h <= 4096, 'the atlas and its red copy are each a canvas this size');
  for (const a of GALAXY_ART) assert.ok(a.i < GALAXY_COLS * rows);
});

test('every galaxy falls inside its own picture', () => {
  // From the picture's own mapping: the catalogue position, put through the
  // corners, lands inside the tile -- the Large Magellanic Cloud included,
  // though it fills only the top half of its frame.
  for (const a of GALAXY_ART) {
    const g = GALAXIES.find((x) => x.key === a.k);
    const [u, v] = inTile(a, g.ra, g.dec);
    assert.ok(u > 0.1 && u < 0.9 && v > 0.1 && v < 0.9, `${a.k} lands at (${u.toFixed(2)}, ${v.toFixed(2)})`);
  }
});

test('M 32 and M 110 are inside the Andromeda picture', () => {
  const m31 = GALAXY_ART.find((a) => a.k === 'm31');
  for (const key of ['m32', 'm110']) {
    const g = GALAXIES.find((x) => x.key === key);
    const [u, v] = inTile(m31, g.ra, g.dec);
    assert.ok(u > 0 && u < 1 && v > 0 && v < 1, `${key} at (${u.toFixed(2)}, ${v.toFixed(2)})`);
  }
});

test('north is up and east is left in every picture, as the sky is seen', () => {
  // Measured, not assumed: a mirrored picture would put east on the right.
  // In each tile, moving toward celestial north must go up the picture
  // (rotated by the picture's own angle), and the turn from north to east
  // must be the same way round as on the sky seen from inside.
  for (const a of GALAXY_ART) {
    const g = GALAXIES.find((x) => x.key === a.k);
    const [u0, v0] = inTile(a, g.ra, g.dec);
    const [un, vn] = inTile(a, g.ra, g.dec + 0.05);
    const [ue, ve] = inTile(a, g.ra + 0.05 / Math.cos(g.dec * Math.PI / 180), g.dec);
    const n = [un - u0, vn - v0], e = [ue - u0, ve - v0];
    // Image y points down: north-to-east is counter-clockwise on screen when
    // the cross product, in these coordinates, is negative.
    const cross = n[0] * e[1] - n[1] * e[0];
    assert.ok(cross < 0, `${a.k}: east is on the wrong side of north (cross ${cross.toExponential(2)})`);
  }
});

test('every picture is credited, CC BY 4.0, with its source page, and pinned', () => {
  const pins = JSON.parse(text('../scripts/galaxy-art-sources.json'));
  assert.equal(GALAXY_CREDITS.length, GALAXY_ART.length);
  for (const a of GALAXY_ART) {
    const c = GALAXY_CREDITS.find((x) => x.k === a.k);
    assert.ok(c && c.credit.length > 2, `${a.k} has a credit`);
    assert.equal(c.license, 'CC BY 4.0');
    assert.match(c.page, /^https:\/\/(noirlab\.edu|www\.eso\.org|esahubble\.org)\//);
    assert.match(pins[a.k] || '', /^[0-9a-f]{64}$/, `${a.k}'s source is pinned by sha256`);
    assert.ok(readme.includes(c.page), `README lists ${a.k}'s source`);
  }
});

test('the key credits them while they are drawn, and links to the full list', () => {
  assert.match(html, /<li class="leg-row leg-credit" id="legGalaxyArt" hidden><a href="https:\/\/github\.com\/evomedia-net\/evo\.polaris#galaxy-pictures"/);
  assert.match(readme, /^## Galaxy pictures$/m, 'the anchor the credit links to');
  assert.match(appJs, /const galaxyPics = skyShowGalaxies && galaxyArt\.mode === 'figures';/);
  assert.match(appJs, /if \(galaxyCredit\) galaxyCredit\.hidden = !galaxyPics;/);
});

test('drawn by the figures\' layer, before the stars, with no outline over a picture', () => {
  assert.match(appJs, /const galaxyArt = createConstellationArt\(\{[\s\S]*?src: '\.\/src\/data\/galaxies\.webp', tile: GALAXY_TILE, cols: GALAXY_COLS,/);
  assert.match(appJs, /galaxyArt: skyShowGalaxies && galaxyArt\.mode === 'figures' \? galaxyArt : null,/, 'they follow the Galaxies switch');
  const art = skydraw.indexOf('o.galaxyArt.draw(ctx');
  assert.ok(art > 0 && art < skydraw.indexOf('// STARS, IN THREE PASSES.'), 'before the stars');
  assert.ok(art < skydraw.indexOf('ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);'), 'and before the outlines');
  assert.match(skydraw, /const pictured = o\.galaxyArt && o\.pictured && o\.pictured\.has\(g\.key\);/);
});

test('they work offline', () => {
  assert.ok(sw.includes("'./src/data/galaxies.webp', './src/data/galaxy-art.js',"));
});
