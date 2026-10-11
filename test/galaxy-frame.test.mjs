// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fovAlong } from '../site/src/motion.js';
import { GALAXIES } from '../site/src/data/galaxies.js';

// A GALAXY IS FRAMED, NOT LEFT AS A DOT (#271).
//
// "first two galaxies looks good, rest are tiny dots, andromeda has none."
// The galaxies are drawn at their true size, and at the tightest field the
// view had -- ten degrees -- M 94 was fifteen pixels and the Sombrero eleven,
// while the target ring sat on Andromeda's photograph and hid it. Kelly
// chose to keep the true size and FRAME each one instead: the Galaxies
// button sets the field so the galaxy's long axis spans a share of the
// view, going below +0 to do it, and only while a galaxy is the target.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const num = (name) => Number(appJs.match(new RegExp(`^const ${name} = ([\\d.]+);`, 'm'))[1]);
const FOV_FLOOR = num('FOV_FLOOR');
const FRAME_SHARE = num('FRAME_SHARE');

/** frameFov(), as app.js writes it: the field for a w x h canvas. */
function framed(maj, w, h) {
  const half = Math.tan((maj / 120) * Math.PI / 180);
  const fov = 2 * Math.atan(half * w / (FRAME_SHARE * Math.min(w, h))) * 180 / Math.PI;
  return Math.min(45, Math.max(FOV_FLOOR, fov));
}

/** How long the long axis lands on a canvas `w` wide at a field. */
function onScreen(maj, w, fov) {
  const focal = (w / 2) / Math.tan((fov / 2) * Math.PI / 180);
  return 2 * Math.tan((maj / 120) * Math.PI / 180) * focal;
}

test('frameFov is the formula these tests check', () => {
  const fn = appJs.slice(appJs.indexOf('function frameFov('), appJs.indexOf('function updateZoomButtons('));
  assert.match(fn, /const half = Math\.tan\(\(g\.maj \/ 120\) \* Math\.PI \/ 180\);/);
  assert.match(fn, /const fov = 2 \* Math\.atan\(half \* w \/ \(FRAME_SHARE \* Math\.min\(w, h\)\)\) \* 180 \/ Math\.PI;/);
  assert.match(fn, /return Math\.min\(maxFov\(\), Math\.max\(FOV_FLOOR, fov\)\);/);
});

test('every galaxy, framed, spans the same share of the short side, held either way', () => {
  for (const [w, h] of [[780, 1688], [1688, 780], [800, 800]]) {
    for (const g of GALAXIES) {
      const fov = framed(g.maj, w, h);
      if (fov >= 45) continue;          // the Large Magellanic Cloud, sideways
      const share = onScreen(g.maj, w, fov) / Math.min(w, h);
      assert.ok(Math.abs(share - FRAME_SHARE) < 1e-9,
        `${g.name} on ${w}x${h}: ${(share * 100).toFixed(1)}% of the short side`);
    }
  }
});

test('the dots the report named are big now, and the floor never squeezes one', () => {
  // On a phone held upright, the canvas width is its short side.
  const [w, h] = [780, 1688];
  for (const g of GALAXIES) {
    assert.ok(framed(g.maj, w, h) > FOV_FLOOR,
      `${g.name} is held at the floor instead of framed`);
    assert.ok(onScreen(g.maj, w, framed(g.maj, w, h)) >= 0.4 * w - 1e-6,
      `${g.name} is still a dot`);
  }
  // The smallest is M 32, at under a third of a degree.
  const m32 = GALAXIES.find((g) => g.key === 'm32');
  assert.ok(framed(m32.maj, w, h) < 0.4, `M 32 framed at ${framed(m32.maj, w, h)} degrees`);
});

test('below +0 only on a galaxy, and only steered by hand', () => {
  assert.match(appJs, /^const FOV_FLOOR = 0\.25;/m);
  assert.match(appJs, /^const FRAME_SHARE = 0\.4;/m);
  const fn = appJs.slice(appJs.indexOf('function minFov()'), appJs.indexOf('function frameFov('));
  assert.match(fn, /return guideTarget\.startsWith\('gal:'\) && !skyFollow \? FOV_FLOOR : FOV_MIN;/);
  // Turning Auto Mode on comes back out: a hand-held phone at a third of a
  // degree is a blur.
  const mode = appJs.slice(appJs.indexOf("$('modeBtn').onclick"), appJs.indexOf('// Arrow keys, one key at a time'));
  assert.match(mode, /if \(skyFollow && skyFov < FOV_MIN\) \{ cancelGlide\(\); skyFov = FOV_MIN; updateZoomButtons\(\); \}/);
});

test('the Galaxies button frames; anything else lets the field back out', () => {
  // The galaxy target carries its size, and goToTarget frames from it.
  assert.match(appJs, /return \{ alt, az, name: g\.name, maj: g\.maj \};/);
  const go = appJs.slice(appJs.indexOf('function goToTarget('), appJs.indexOf("$('tgtPole').onclick"));
  assert.match(go, /glideTo\(t\.az, t\.alt, t\.maj \? \{ fov: frameFov\(t\) \} : \{\}\)/);
  // A journey with no field asked for is clamped to what the new target
  // allows, so the pole, a planet or a tap all come back out to +0.
  const glide = appJs.slice(appJs.indexOf('function glideTo('), appJs.indexOf('function pan('));
  assert.match(glide, /const toFov = Math\.min\(maxFov\(\), Math\.max\(minFov\(\), fov \?\? skyFov\)\);/);
  assert.ok(glide.indexOf('skyFollow = false;') < glide.indexOf('const toFov'),
    'minFov() reads skyFollow, so the journey must have taken the view first');
  assert.match(glide, /if \(zooms\) skyFov = fovAlong\(fromFov, toFov, t\);/);
  assert.match(glide, /skyFov = toFov;\s*\n\s*updateZoomButtons\(\);/,
    'held still, or a hidden tab, it still arrives at the field');
  // Letting go -- the empty stop at the end of the walk -- has no journey of
  // its own, so setTarget starts one that only zooms.
  const set = appJs.slice(appJs.indexOf('function setTarget('), appJs.indexOf('function updateTargetName('));
  assert.match(set, /if \(skyFov < minFov\(\)\) glideTo\(skyAim\.az, skyAim\.alt\);/);
  // A journey cut short by arriving lands on its field too.
  const cancel = appJs.slice(appJs.indexOf('function cancelGlide('), appJs.indexOf('function glideTo('));
  assert.match(cancel, /if \(fov != null\) skyFov = fov;/);
  // And the ring is told the size, so it can go round it.
  assert.match(appJs, /targetMaj: target && target\.maj \? target\.maj : null,/);
});

test('below +0 the zoom buttons halve and double, and land back on +0', () => {
  const wider = appJs.slice(appJs.indexOf("$('skyWider').onclick"), appJs.indexOf("$('skyNarrower').onclick"));
  const narrower = appJs.slice(appJs.indexOf("$('skyNarrower').onclick"), appJs.indexOf("$('fullIn').onclick"));
  assert.match(wider, /\? Math\.min\(FOV_MIN, skyFov \* 2\)/);
  assert.match(narrower, /: Math\.max\(minFov\(\), skyFov \/ 2\);/);
  for (const block of [wider, narrower]) {
    assert.match(block, /if \(glide && glide\.fov != null\) cancelGlide\(true\);/,
      'a press during a zooming journey finishes it first');
  }
  // The ladder, worked: from M 94 framed, out lands on 10 exactly.
  let fov = framed(11.22, 780, 1688);
  const out = [];
  while (fov < 10) { fov = Math.min(10, fov * 2); out.push(fov); }
  assert.equal(out.at(-1), 10);
  assert.ok(out.length <= 6, `${out.length} presses back to +0`);
});

test('the arrows move a share of the field below +0, not fifteen degrees', () => {
  assert.match(appJs, /function panScale\(\) \{\n {2}return Math\.min\(1, skyFov \/ FOV_MIN\);\n\}/);
  const nudge = appJs.slice(appJs.indexOf('function nudge('), appJs.indexOf('let hold = null;'));
  assert.match(nudge, /const k = panScale\(\);\s*\n\s*dAz \*= k; dAlt \*= k;/);
  assert.match(appJs, /cruise: HOLD_CRUISE \}\) \* panScale\(\);/, 'and a hold, too');
});

test('a zooming journey turns first and zooms last, by the logarithm', () => {
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  // The ends are EXACT, not close: the zoom buttons compare the field with
  // +0 and with the floor, and 10.000000000000002 is not at +0.
  assert.equal(fovAlong(20, 0.25, 0), 20);
  assert.equal(fovAlong(20, 0.25, 1), 0.25);
  assert.equal(fovAlong(0.37, 10, 1), 10);
  assert.equal(fovAlong(10, 10, 0.5), 10);
  // Going in, half way through the journey the field is still wide -- far
  // wider than the geometric middle -- because the turn comes first.
  const mid = Math.sqrt(20 * 0.37);
  assert.ok(fovAlong(20, 0.37, 0.5) > 2 * mid, `${fovAlong(20, 0.37, 0.5)} at half way`);
  // Coming out, it opens up early.
  assert.ok(fovAlong(0.37, 10, 0.5) > 2 * Math.sqrt(0.37 * 10));
  // And it never overshoots or turns back.
  let prev = 20;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const f = fovAlong(20, 0.37, t);
    assert.ok(f <= prev + 1e-12 && f >= 0.37 - 1e-12);
    prev = f;
  }
});
