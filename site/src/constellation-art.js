// The constellation figures, ghosted onto the sky.
//
// James Hedberg drew all 88 of them and placed them where they belong; the
// app ships twenty-six -- the zodiac, and the figures a beginner's chart
// names first, chosen in scripts/build-constellation-art.py -- and draws
// them behind the stars, so the lines the app already draws stop being an
// abstract join-the-dots and become the figure they are named for. The
// stars are drawn after the art, so they stay the subject.
//
// WHERE THE GEOMETRY IS. Not here. Each figure's four corners are worked
// out once by scripts/build-constellation-art.py, in equatorial J2000, and
// checked there against this app's own star catalogue. This module carries
// no galactic conversion, no Euler convention and no plane maths.
//
// IT ALSO DOES NOT CONVERT FRAMES, AND THAT IS THE POINT OF TAKING THE
// CORNERS AS AN ARGUMENT. Everything else on this canvas -- every star,
// every planet -- is rotated out of equatorial coordinates into the
// horizontal frame before it is projected, because the basis the projection
// uses is a horizontal one. This layer originally projected the corners
// straight from J2000 against that same basis, which is a frame mismatch:
// the figures landed at a sky position that depended on the time of night
// and the latitude, so they drifted away from the very stars they were
// drawn around. Reported as "that orion image isn't even close to the
// reference". The caller now hands over corners already in the frame the
// basis is in, the same way it hands over stars.
//
// WHY A QUAD IS NOT ENOUGH. A figure spans thirty or forty degrees, and a
// gnomonic projection bends a shape that size: its edges are curves, not
// straight lines, and its diagonals do not stay straight either. Drawing the
// image into a single four-cornered shape would visibly shear Orion. So the
// quad is subdivided and each little cell drawn separately, which is what
// makes the curvature come out right -- the same reason the ground is drawn
// as cells rather than as one hemisphere.
//
// CANVAS CANNOT MAP A TEXTURE ONTO A QUADRILATERAL, only onto a triangle via
// an affine transform, so every cell is drawn as two triangles. The one
// pixel of overlap between them is deliberate: without it a hairline seam
// shows through along every shared edge, and a grid of hairlines across a
// ghost is far more visible than the ghost.

import { FIGURE_TILE, FIGURE_COLS } from './data/figures.js';
import { projectToScreen } from './skyview.js';

const SRC = './src/data/figures.webp';

export const CREDIT = 'Figures: James Hedberg';

// HOW FINELY EACH FIGURE IS SUBDIVIDED, DECIDED PER FRAME.
//
// It was a flat 4x4, and a flat number is wrong in both directions. Measured
// against the true projection over every shipped figure and a range of views:
// at a wide field, where a figure is a couple of hundred pixels across, one
// cell is already accurate to a pixel and sixteen are fifteen wasted draws;
// zoomed in to a 40-degree field with the figure off to one side, sixteen
// cells leave the artwork SIXTY-SIX pixels from the geometry it is drawn
// around. Reported as "it suddenly seems much slower with the artwork on",
// and the accuracy half came out of the same measurement.
//
// The error of an affine patch grows with the square of its span and falls
// with the square of the subdivision, so the count follows from the figure's
// size on screen. The constant is measured, not assumed: a single cell is
// about 0.031 * span^2 / focal pixels out, which inverts to the expression
// in cellsFor() below.
// 4 px is where the trade sits. Counted over every figure and a sweep of
// fields and off-centre angles, against the fixed 4x4 it draws 70% of the
// triangles for the SAME mean error (4.2 px) and a much better worst one
// (30 px against 47). Tighter costs more than it returns: 2.5 px draws
// every triangle the old grid did, and 1.5 px half again as many.
const CELL_TOLERANCE_PX = 4;
const MIN_CELLS = 1;
const MAX_CELLS = 6;
// Below this much downscale two things change together: the filter stops
// being worth its cost, and the half-size atlas becomes indistinguishable
// from the full one. A tile drawn near its own size wants the opposite of
// both -- every pixel it has, and no filter between them.
const SMALL_SCALE = 0.5;

// WIDE FIELDS PAINT THE LAYER SMALLER AND SCALE IT UP: THE THIRD LEVEL OF
// DETAIL, AFTER THE CELL COUNT AND THE ATLAS.
//
// "it is really slowing down when I zoom out a little" -- which is what the
// numbers say: zoom out and more figures come on screen, each still
// painting its own area. Measured at 1905 x 1080 on a 90-degree field, 14
// figures: 31 ms at full size, 21 at four fifths, 21 at half. Four fifths
// is the whole saving for a fifth of the softening, so that is the step
// taken first; only past a hundred degrees, where the figures are small
// enough that nothing is left to blur, does it go further.
//
// Zoomed in, none of this applies: a figure fills the screen, every line is
// worth its pixels, and the layer is cheap anyway.
const LOD_STEPS = [
  { focal: 0.40, scale: 0.6 },       // wider than about 100 degrees
  { focal: 0.65, scale: 0.8 },       // wider than about 75
];

// HOW STRONGLY THE FIGURES SHOW.
//
// This has moved three times. It shipped at 0.16 and read as "very dim";
// 0.30 was picked from three rendered side by side; a planetarium
// screenshot then made it 0.60 -- there the figures are confident white
// line-art you read at a glance, not a hint you have to look for, and that
// is the thing people actually recognise. Then the tiles went from 256 px
// to 768, and the same number read dimmer: a fine line puts less light in
// the eye than a blurred one spread over more pixels. "I think I'd like
// brighter" -- 0.85 is that, close to the source drawings' own white on
// black, and the stars still sit on top because they are drawn after.
//
// It is one constant, and the switch in Visual Settings (the Art button in
// full screen) is the real answer for anyone who wants the plain sky back.
const DAY_ALPHA = 0.85;
// LOWER AT NIGHT, AND NOT FOR TASTE. Dark adaptation is spent by TOTAL light
// reaching the eye, not by hue, so a red field that is merely bright is
// still a red field that costs twenty minutes to get back. Two thirds of the
// day value, the same ratio as before.
const NIGHT_ALPHA = 0.55;

/**
 * A point of the drawing, as a direction: blend the four corners, then put
 * the result back on the sphere.
 *
 * EXACT, AND ONLY BECAUSE THE CORNERS ARE NOT UNIT VECTORS. The four are
 * points of the figure's own flat plane at their true distances, and the
 * blend of four corners of a flat parallelogram is a point of that plane;
 * normalising it gives the direction the drawing was placed in, tilt and
 * all. Blending unit corners instead flattens the tilt away -- measured,
 * that moved Orion's middle by a degree and Pegasus's by six while every
 * corner stayed exactly right.
 */
function corner(c, u, v) {
  const [tl, tr, br, bl] = c;
  const x = (1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0] + u * v * br[0] + (1 - u) * v * bl[0];
  const y = (1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1] + u * v * br[1] + (1 - u) * v * bl[1];
  const z = (1 - u) * (1 - v) * tl[2] + u * (1 - v) * tr[2] + u * v * br[2] + (1 - u) * v * bl[2];
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
}

/**
 * How many cells this figure needs, from its size on screen.
 *
 * A CORNER BEHIND THE VIEWER MUST NOT MEAN "SUBDIVIDE AS FINELY AS
 * POSSIBLE". That was the first version of this, and it was backwards: zoom
 * in far enough and most figures have a corner off the back of the view, so
 * nearly every figure took the finest subdivision at once -- 72 triangles
 * each where sixteen had been drawn before, and the layer got TWICE as
 * expensive at exactly the field where it was already dearest. Measured at
 * 1905x1080: 19.5 ms of artwork against the 9.2 ms it replaced.
 *
 * So the size comes from the figure's own angular span when the screen
 * cannot supply it. That is a property of the data, always defined, and at
 * a narrow field it is the honest answer: a figure wider than the view
 * needs no more cells than the view can show.
 */
function cellsFor(c, basis, focal, cx, cy) {
  const p = [];
  for (const v of c) {
    const q = projectToScreen(v, basis, focal);
    p.push(q ? [cx + q.x, cy + q.y] : null);
  }
  const across = (a, b) => (p[a] && p[b]
    ? Math.hypot(p[b][0] - p[a][0], p[b][1] - p[a][1]) : 0);
  // The angular diagonal, projected as if it were centred: never fails, and
  // it is what the visible piece of an oversized figure actually subtends.
  const [tl, , br] = c;
  const dot = (tl[0] * br[0] + tl[1] * br[1] + tl[2] * br[2])
    / (Math.hypot(tl[0], tl[1], tl[2]) * Math.hypot(br[0], br[1], br[2]));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const fromSky = 2 * focal * Math.tan(Math.min(theta, Math.PI / 3) / 2);
  const span = Math.max(across(0, 2), across(1, 3), fromSky);
  // n = span * sqrt(0.031 / (focal * tolerance)), with the constant measured.
  const n = Math.ceil(span * Math.sqrt(0.031 / (focal * CELL_TOLERANCE_PX)));
  return {
    cells: Math.max(MIN_CELLS, Math.min(MAX_CELLS, n)),
    // How big the tile lands compared with how it is stored: under 1 is a
    // downscale, which is where the filter matters.
    scale: span / (FIGURE_TILE * Math.SQRT2),
  };
}

/**
 * One texture triangle: map three points of the image onto three of the
 * screen with the affine transform that takes one to the other, clipped to
 * the triangle so nothing spills outside it.
 */
function triangle(ctx, img, s0, s1, s2, d0, d1, d2) {
  const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (!den) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;

  ctx.save();
  ctx.beginPath();
  // Grown by a pixel about its own centre, so neighbouring cells overlap
  // rather than leaving a seam between them.
  const gx = (d0[0] + d1[0] + d2[0]) / 3, gy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => {
    const dx = p[0] - gx, dy = p[1] - gy;
    const m = Math.hypot(dx, dy) || 1;
    return [p[0] + dx / m, p[1] + dy / m];
  };
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d,
    d0[0] - a * s0[0] - c * s0[1],
    d0[1] - b * s0[0] - d * s0[1]);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * The figure layer. draw() paints whatever is on screen and answers how many
 * figures it managed; zero is a perfectly good answer and never an error.
 */
export function createConstellationArt({ forceOff = false } = {}) {
  const layer = { mode: 'loading', ready: null };
  let img = null;
  let red = null;
  // THE ATLAS AT HALF SIZE, WHICH IS WHAT MOST FRAMES ACTUALLY WANT.
  //
  // A tile is 680 px and is usually drawn two or three hundred pixels
  // across, so every draw asks the browser to sample a 3400 x 4080 texture
  // down to a fraction of itself. Measured at 1905 x 1080 with sixteen
  // figures on a wide field: 77 ms from the full atlas against 55 from a
  // half-size one, for pixels nobody can see at that scale. The full atlas
  // is still used wherever a figure is drawn near or above its stored size,
  // which is where the detail is real. Night Mode keeps the full one too:
  // it is a narrow-field mode and its atlas is already a tinted copy.
  //
  // Built once, after the atlas loads, and only if the browser can -- an
  // optimisation that throws is worse than no optimisation.
  let mip = null;
  let buffer = null;            // the half-size canvas wide fields are painted into

  layer.ready = new Promise((resolve) => {
    if (forceOff) { layer.mode = 'off'; resolve(false); return; }
    const el = new Image();
    el.onload = () => {
      img = el;
      layer.mode = 'figures';
      try {
        const c = document.createElement('canvas');
        c.width = Math.max(1, img.width >> 1);
        c.height = Math.max(1, img.height >> 1);
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        mip = c;
      } catch { mip = null; }
      resolve(true);
    };
    el.onerror = () => { layer.mode = 'off'; resolve(false); };
    el.src = SRC;
  });

  /**
   * The atlas again, with green and blue taken out.
   *
   * Night Mode is pure red on black, and an additive draw of a WHITE ghost
   * would put grey on the screen however faint it was -- which is exactly
   * the dark adaptation the mode exists to protect. Tinted once, on first
   * use, rather than per frame.
   *
   * Tinted by a multiply with pure red, which keeps the red channel and
   * zeroes the other two exactly, in place. The earlier way -- getImageData,
   * a loop over every pixel, putImageData -- copied the whole atlas through
   * JavaScript, and at an atlas this size that copy is nearly sixty
   * megabytes on a phone. This canvas is the same size as the atlas, which
   * is why the atlas stays inside 4096 x 4096: the largest canvas every
   * phone will make.
   */
  function redAtlas() {
    if (red || !img) return red;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, c.width, c.height);
    // The atlas ships opaque, brightness on black. Should it ever ship with
    // an alpha channel again, this keeps the multiply from painting its
    // transparent parts red.
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    red = c;
    return red;
  }

  layer.draw = function draw(target, opts) {
    const { figures, basis, focal, w, h } = opts;
    if (!img || !figures || !figures.length) return 0;
    // At a wide field, paint into a smaller buffer and scale it up once.
    const step = opts.noScale ? null : LOD_STEPS.find((l) => focal < l.focal * w);
    if (step) {
      const s = step.scale;
      const bw = Math.max(1, Math.round(w * s)), bh = Math.max(1, Math.round(h * s));
      if (!buffer) buffer = document.createElement('canvas');
      if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
      const bg = buffer.getContext('2d');
      bg.setTransform(1, 0, 0, 1, 0, 0);
      bg.clearRect(0, 0, bw, bh);
      const n = draw(bg, {
        ...opts, noScale: true, focal: focal * s, cx: opts.cx * s, cy: opts.cy * s, w: bw, h: bh,
      });
      if (n) {
        target.save();
        target.globalCompositeOperation = 'lighter';
        target.imageSmoothingQuality = 'high';
        target.drawImage(buffer, 0, 0, bw, bh, 0, 0, w, h);
        target.restore();
      }
      return n;
    }
    return paint(target, opts);
  };

  function paint(ctx, { figures, basis, focal, cx, cy, w, h, night, opacity = null }) {
    let drawn = 0;

    const sheet = night ? redAtlas() : img;
    if (!sheet) return 0;

    ctx.save();
    ctx.globalAlpha = opacity === null ? (night ? NIGHT_ALPHA : DAY_ALPHA) : opacity;
    // Additive, so the art only ever LIGHTENS the sky: a ghost that could
    // darken would punch holes in the Milky Way behind it. It is also why
    // the atlas needs no alpha channel: black adds nothing, so the ink is
    // stored as brightness on black, at a third of the size.
    ctx.globalCompositeOperation = 'lighter';
    // Smoothing is set per figure, just below: see SMOOTH_BELOW_SCALE.

    for (const fig of figures) {
      // Project the grid once.
      //
      // CULLED CELL BY CELL, NOT FIGURE BY FIGURE. This used to skip the
      // whole figure the moment ANY of its corners failed to project, and a
      // figure is forty or fifty degrees across -- so zoomed in, a corner is
      // routinely off the edge or behind the viewer, and the figure you were
      // looking straight at was the first to vanish. What stayed on screen
      // were its NEIGHBOURS, whose corners still projected, which reads
      // exactly like artwork that does not line up with its stars. Reported
      // as "do these look aligned to you?" -- they were not, because the
      // aligned one was not being drawn at all.
      const { cells, scale } = cellsFor(fig.c, basis, focal, cx, cy);
      // Small on screen: the half-size atlas, and the filter that holds a
      // downscale together. Large: every pixel the atlas has, and no filter.
      const small = scale < SMALL_SCALE;
      const sheetNow = small && !night && mip ? mip : sheet;
      const shrink = sheetNow === mip ? 0.5 : 1;
      ctx.imageSmoothingQuality = small ? 'high' : 'low';
      const pts = [];
      let anyOn = false;
      for (let iy = 0; iy <= cells; iy++) {
        for (let ix = 0; ix <= cells; ix++) {
          const v = corner(fig.c, ix / cells, iy / cells);
          const q = projectToScreen(v, basis, focal);
          if (!q) { pts.push(null); continue; }
          const x = cx + q.x, y = cy + q.y;
          if (x > -w && x < w * 2 && y > -h && y < h * 2) anyOn = true;
          pts.push([x, y]);
        }
      }
      if (!anyOn) continue;                       // nothing of it is on screen

      const col = fig.i % FIGURE_COLS, row = Math.floor(fig.i / FIGURE_COLS);
      const sx = col * FIGURE_TILE, sy = row * FIGURE_TILE;
      const at = (ix, iy) => pts[iy * (cells + 1) + ix];
      const src = (ix, iy) => [(sx + (ix / cells) * FIGURE_TILE) * shrink,
                               (sy + (iy / cells) * FIGURE_TILE) * shrink];

      for (let iy = 0; iy < cells; iy++) {
        for (let ix = 0; ix < cells; ix++) {
          const s00 = src(ix, iy), s10 = src(ix + 1, iy);
          const s11 = src(ix + 1, iy + 1), s01 = src(ix, iy + 1);
          const d00 = at(ix, iy), d10 = at(ix + 1, iy);
          const d11 = at(ix + 1, iy + 1), d01 = at(ix, iy + 1);
          // A CELL OFF THE EDGE COSTS NOTHING NOW. The figure as a whole was
          // already culled, but a figure can be several times the width of
          // the screen -- zoomed in, most of its cells are outside it, and
          // each one was still a clip, a transform and a draw of the atlas.
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const q of [d00, d10, d11, d01]) {
            if (!q) continue;
            if (q[0] < minX) minX = q[0];
            if (q[0] > maxX) maxX = q[0];
            if (q[1] < minY) minY = q[1];
            if (q[1] > maxY) maxY = q[1];
          }
          if (maxX < -1 || minX > w + 1 || maxY < -1 || minY > h + 1) continue;
          // A cell with a corner behind the viewer has no honest shape on
          // screen; the rest of the figure is still perfectly drawable.
          if (d00 && d10 && d11) triangle(ctx, sheetNow, s00, s10, s11, d00, d10, d11);
          if (d00 && d11 && d01) triangle(ctx, sheetNow, s00, s11, s01, d00, d11, d01);
        }
      }
      drawn++;
    }
    ctx.restore();
    return drawn;
  }

  return layer;
}
