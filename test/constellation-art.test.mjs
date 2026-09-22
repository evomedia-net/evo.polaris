import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIGURES, FIGURE_TILE, FIGURE_COLS } from '../site/src/data/figures.js';
import { CREDIT } from '../site/src/constellation-art.js';

// THE CONSTELLATION FIGURES, AND EVERYTHING ABOUT THEM THAT CAN BE WRONG
// WITHOUT A CANVAS.
//
// The drawing needs a browser and is checked there. What is checked here is
// the data the drawing is made from -- which figures ship, that the atlas
// agrees with the code that indexes it, that every figure is a real patch of
// sky -- and the decisions the code has to keep: the corners' lengths, the
// frame they are rotated into, how bright the art is by day and by night,
// and that the atlas is precached and small enough to be.

const root = new URL('../site/', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');
const appJs = read('src/app.js');
const art = read('src/constellation-art.js');
const skydraw = read('src/skydraw.js');
const sw = read('sw.js');
const build = readFileSync(
  fileURLToPath(new URL('../scripts/build-constellation-art.py', import.meta.url)), 'utf8');

const DEG = Math.PI / 180;
const ZODIAC = ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'];
const abbrs = FIGURES.map((f) => f.a);
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const sep = (a, b) => Math.acos(Math.max(-1, Math.min(1,
  (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b))))) / DEG;

// --- which figures ship -----------------------------------------------------------

test('the twelve of the zodiac all ship', () => {
  for (const z of ZODIAC) assert.ok(abbrs.includes(z), `${z} is missing`);
});

test('the Polaris star-hop ships: the Big Dipper, the Little Dipper and Cassiopeia', () => {
  // URSA MAJOR IS THE REGRESSION. The source CSV spells it "Uma" and its
  // image is "UMa.png"; matched by abbreviation, the Big Dipper -- the
  // pointer to Polaris on this app's own front page -- silently never
  // shipped, in a build that reported 84 figures and no error.
  for (const a of ['UMa', 'UMi', 'Cas']) assert.ok(abbrs.includes(a), `${a} is missing`);
  assert.match(build, /by_image = \{r\[7\]\[:-4\]: r/,
    'rows are matched by image name, not by the abbreviation column');
});

test('twenty-five figures, each once, in a five-by-five atlas', () => {
  // "it's a bit crowded" -- the zodiac and the figures a beginner's chart
  // names first, and no more. Twenty-five because Night Mode tints a copy
  // of the atlas on a canvas the same size, 4096 x 4096 is the largest
  // canvas every phone will make, and 768 px tiles fit that five by five.
  assert.equal(FIGURES.length, 25);
  assert.equal(new Set(abbrs).size, 25, 'no figure twice');
  assert.equal(FIGURE_COLS, 5);
  assert.equal(FIGURE_TILE, 768);
  assert.equal(new Set(FIGURES.map((f) => f.i)).size, 25, 'no two figures share a tile');
  for (const f of FIGURES) assert.ok(f.i >= 0 && f.i < 25, `${f.a} tile ${f.i} is off the atlas`);
});

// --- the atlas and the code that indexes it -------------------------------------------

function webpSize(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  assert.equal(buf.toString('latin1', 8, 12), 'WEBP');
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // Simple lossy: after the 3-byte frame tag and the 3-byte start code,
    // width and height as 14-bit little-endian values.
    return { w: (buf[26] | (buf[27] << 8)) & 0x3fff, h: (buf[28] | (buf[29] << 8)) & 0x3fff };
  }
  if (chunk === 'VP8X') {
    // Extended: canvas width and height as 24-bit values, each one less.
    return {
      w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  }
  throw new Error(`unexpected WebP chunk ${JSON.stringify(chunk)}`);
}

test('the atlas is exactly the tiles the data indexes, and fits the safe canvas', () => {
  const buf = readFileSync(fileURLToPath(new URL('src/data/figures.webp', root)));
  const { w, h } = webpSize(buf);
  const rows = Math.ceil(FIGURES.length / FIGURE_COLS);
  assert.equal(w, FIGURE_COLS * FIGURE_TILE, `atlas width ${w}`);
  assert.equal(h, rows * FIGURE_TILE, `atlas height ${h}`);
  assert.ok(w <= 4096 && h <= 4096, `${w}x${h} is larger than the canvas every phone will make`);
});

test('the atlas ships, is precached, and is small enough to be', () => {
  const f = fileURLToPath(new URL('src/data/figures.webp', root));
  const kb = statSync(f).size / 1024;
  assert.ok(kb > 100, 'the atlas is missing or empty');
  assert.ok(kb < 700, `${kb.toFixed(0)} KB is too much to precache for twenty-five drawings`);
  assert.match(sw, /'\.\/src\/data\/figures\.webp'/, 'the atlas must be in the precache list');
  assert.match(sw, /'\.\/src\/data\/figures\.js'/, 'and the placements');
  assert.match(sw, /'\.\/src\/constellation-art\.js'/, 'and the module that draws them');
});

// --- every figure is a real patch of sky ----------------------------------------------

test('every figure is a flat parallelogram at its true distance, not four unit vectors', () => {
  // THE TILT. OpenSpace's planes sit up to 28 degrees off the line of
  // sight, so their near and far corners are at different distances. The
  // layer blends the four corners and normalises the result, and that is
  // exact for the corners of a flat parallelogram -- and wrong for unit
  // vectors, which flatten the tilt away and moved the middle of Pegasus
  // six degrees while its corners stayed put.
  let tilted = 0;
  for (const f of FIGURES) {
    assert.equal(f.c.length, 4, `${f.a} has ${f.c.length} corners`);
    const [tl, tr, br, bl] = f.c;
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs((tl[k] + br[k]) - (tr[k] + bl[k])) < 1e-5,
        `${f.a}: opposite corners do not add up, so it is not a parallelogram`);
    }
    const lengths = f.c.map(norm);
    for (const m of lengths) assert.ok(m > 0.5 && m < 2, `${f.a} corner at distance ${m}`);
    if (Math.max(...lengths) - Math.min(...lengths) > 1e-3) tilted++;
  }
  assert.ok(tilted > 20, `only ${tilted} figures carry a tilt; the corners have been normalised`);
});

test('every figure spans a sensible piece of sky', () => {
  for (const f of FIGURES) {
    const [tl, , br] = f.c;
    const diag = sep(tl, br);
    // A few degrees would be a tile drawn for nothing; much over ninety, a
    // plane that has stopped approximating the sphere.
    assert.ok(diag > 5 && diag < 100, `${f.a} spans ${diag.toFixed(1)}° corner to corner`);
  }
});

test('Orion hangs where Orion is', () => {
  // The independent check: the figure's centre must be near the belt. If
  // the galactic conversion, the Euler convention or the crop went wrong,
  // this is where it shows -- Orion is the figure everyone checks first.
  const ori = FIGURES.find((f) => f.a === 'Ori');
  assert.ok(ori, 'Orion ships');
  const c = [0, 1, 2].map((k) => ori.c.reduce((s, v) => s + v[k], 0) / 4);
  const alnilam = [
    Math.cos(-1.2 * DEG) * Math.cos(84.05 * DEG),
    Math.cos(-1.2 * DEG) * Math.sin(84.05 * DEG),
    Math.sin(-1.2 * DEG),
  ];
  const off = sep(c, alnilam);
  assert.ok(off < 6, `Orion's centre is ${off.toFixed(1)}° from the belt`);
});

// --- the decisions the code has to keep ---------------------------------------------

test('the corners are rotated into the horizontal frame with the stars, and keep their length', () => {
  // The frame bug this locks: the layer projected the corners straight
  // from J2000 against a horizontal basis, so the figures drifted with the
  // time of night and the latitude, away from the stars they were drawn
  // around -- "that orion image isn't even close to the reference."
  const start = appJs.indexOf('skyFigureCorners = FIGURES.map');
  assert.ok(start > 0, 'the corners are rebuilt on the slow tick');
  const block = appJs.slice(start, appJs.indexOf('}));', start));
  assert.match(block, /equatorialToVector\(/, 'each corner makes the journey every star makes');
  assert.match(block, /lst, site\.lat, precess/, 'with the same sidereal time, latitude and precession');
  assert.match(block, /Math\.hypot\(v\[0\], v\[1\], v\[2\]\)/, 'the length is measured');
  assert.match(block, /return \[d\[0\] \* m, d\[1\] \* m, d\[2\] \* m\];/, 'and given back');
  assert.doesNotMatch(art, /equatorialToVector|altAzToVector/, 'and the layer itself converts no frames');
  assert.match(skydraw, /o\.figureArt\.draw\(ctx, \{ figures: o\.figures,/, 'the layer draws what it is handed');
});

test('bright by day, dimmer by night, and both in one place', () => {
  const day = art.match(/^const DAY_ALPHA = ([0-9.]+);/m);
  const night = art.match(/^const NIGHT_ALPHA = ([0-9.]+);/m);
  assert.ok(day && night, 'both constants exist');
  const d = Number(day[1]), n = Number(night[1]);
  assert.ok(d >= 0.8 && d <= 1, `day ${d}: "I think I'd like brighter"`);
  // Dark adaptation is spent by total light, not hue: night is a real
  // reduction, about two thirds of the day value.
  assert.ok(n < d, 'night is dimmer than day');
  assert.ok(n / d > 0.55 && n / d < 0.75, `night is ${(n / d).toFixed(2)} of day; two thirds is the ratio`);
  assert.match(art, /globalCompositeOperation = 'lighter'/, 'additive: the art only ever lightens the sky');
  assert.match(art, /imageSmoothingQuality = 'high'/, 'and a 768 px tile is downscaled with a real filter');
});

test('the night tint keeps only red, and never copies the atlas through JavaScript', () => {
  const fn = art.slice(art.indexOf('function redAtlas()'), art.indexOf('return red;\n  }'));
  assert.match(fn, /globalCompositeOperation = 'multiply'/);
  assert.match(fn, /fillStyle = '#ff0000'/);
  assert.doesNotMatch(fn, /getImageData/,
    'a per-pixel copy of a 3840x3840 atlas is sixty megabytes on a phone');
});

test('a figure is culled cell by cell, not by its corners', () => {
  // Zoomed in, a corner is routinely off the edge or behind the viewer;
  // skipping the whole figure then hid exactly the one being looked at,
  // and what remained were its neighbours -- "do these look aligned?"
  assert.match(art, /if \(!anyOn\) continue;/);
  assert.match(art, /if \(d00 && d10 && d11\) triangle\(/);
  assert.match(art, /if \(d00 && d11 && d01\) triangle\(/);
});

// --- the hand-matching ---------------------------------------------------------------

test('the hand-matching data is well formed, and every matched figure ships', () => {
  // "so many are just off" -- and no placement fixes a drawing whose
  // proportions are not the sky's, so those drawings are reshaped by hand:
  // landmarks on the tile and the star each must sit on, applied by the
  // build as a thin-plate spline. Three points is the least a spline can
  // take; a target is a Bayer letter or a [u, v] pin.
  const matching = JSON.parse(readFileSync(
    fileURLToPath(new URL('../scripts/figure-matching.json', import.meta.url)), 'utf8'));
  const figures = Object.keys(matching).filter((k) => !k.startsWith('_'));
  assert.ok(figures.length >= 8, `${figures.length} figures are matched; eight were`);
  for (const a of figures) {
    assert.ok(abbrs.includes(a), `${a} is matched but does not ship`);
    const pts = matching[a];
    assert.ok(Array.isArray(pts) && pts.length >= 3, `${a}: a spline needs at least three points`);
    for (const p of pts) {
      assert.equal(p.length, 3, `${a}: a control point is [u, v, target]`);
      const [u, v, t] = p;
      assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `${a}: landmark (${u}, ${v}) is off the tile`);
      if (Array.isArray(t)) {
        assert.equal(t.length, 2, `${a}: a pin is [u, v]`);
      } else {
        assert.match(t, /^[A-Z][a-z]{1,2}$/, `${a}: "${t}" is not a Bayer letter like Alp or Lam`);
      }
    }
  }
  for (const a of ['Sco', 'Cyg', 'Aql']) {
    assert.ok(figures.includes(a), `${a} was the reported case and must stay matched`);
  }
});

test('the build refuses a match that stretches a drawing too far', () => {
  // The honesty number. A drawing pulled into a shape it was never drawn
  // in is worse than one a degree off its stars.
  assert.match(build, /^MAX_STRETCH = 3\.5$/m);
  assert.match(build, /if stretch > MAX_STRETCH:/);
  assert.match(build, /hand_match\(ink, corners, matching\[abbr\], stars\)/);
});

test('the credit rides with the picture, like the Milky Way’s', () => {
  assert.equal(CREDIT, 'Figures: James Hedberg');
  assert.match(appJs, /figureCredit\.hidden = !figures;/);
});
