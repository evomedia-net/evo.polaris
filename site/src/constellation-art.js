// The constellation figures, ghosted onto the sky.
//
// James Hedberg drew all 88 of them and placed them where they belong; this
// draws them faintly behind the stars, so the lines the app already draws
// stop being an abstract join-the-dots and become the figure they are named
// for. Faint ON PURPOSE -- the stars are the subject and the art is a hint
// behind them, which is also how OpenSpace renders the same pieces.
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

// How finely each figure is subdivided. 4x4 is enough that the curvature
// reads smoothly at any field this app draws and cheap enough that a dozen
// visible figures stay well inside one frame.
const CELLS = 4;

// HOW STRONGLY THE FIGURES SHOW.
//
// This moved twice. It shipped at 0.16 and read as "very dim"; 0.30 was
// picked from three rendered side by side. Then a planetarium screenshot
// settled it: there the figures are confident white line-art you read at a
// glance, not a hint you have to look for, and that is the thing people
// actually recognise -- "I prefer the brighter". 0.60 is that, and the
// stars still sit on top of it because they are drawn after.
//
// It is one constant, and the switch in Visual Settings is the real answer
// for anyone who wants the plain sky back.
const DAY_ALPHA = 0.60;
// LOWER AT NIGHT, AND NOT FOR TASTE. Dark adaptation is spent by TOTAL light
// reaching the eye, not by hue, so a red field that is merely bright is
// still a red field that costs twenty minutes to get back. Two thirds of the
// day value, the same ratio as before.
const NIGHT_ALPHA = 0.40;

/** Spherical-ish bilinear: mix the four corners, then put it back on the sphere. */
function corner(c, u, v) {
  const [tl, tr, br, bl] = c;
  const x = (1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0] + u * v * br[0] + (1 - u) * v * bl[0];
  const y = (1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1] + u * v * br[1] + (1 - u) * v * bl[1];
  const z = (1 - u) * (1 - v) * tl[2] + u * (1 - v) * tr[2] + u * v * br[2] + (1 - u) * v * bl[2];
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
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

  layer.ready = new Promise((resolve) => {
    if (forceOff) { layer.mode = 'off'; resolve(false); return; }
    const el = new Image();
    el.onload = () => { img = el; layer.mode = 'figures'; resolve(true); };
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
   */
  function redAtlas() {
    if (red || !img) return red;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i + 1] = 0; d.data[i + 2] = 0; }
    g.putImageData(d, 0, 0);
    red = c;
    return red;
  }

  layer.draw = function draw(ctx, { figures, basis, focal, cx, cy, w, h, night, opacity = null }) {
    if (!img || !figures || !figures.length) return 0;
    let drawn = 0;

    const sheet = night ? redAtlas() : img;
    if (!sheet) return 0;

    ctx.save();
    ctx.globalAlpha = opacity === null ? (night ? NIGHT_ALPHA : DAY_ALPHA) : opacity;
    // Additive, so the art only ever LIGHTENS the sky: a ghost that could
    // darken would punch holes in the Milky Way behind it.
    ctx.globalCompositeOperation = 'lighter';

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
      const pts = [];
      let anyOn = false;
      for (let iy = 0; iy <= CELLS; iy++) {
        for (let ix = 0; ix <= CELLS; ix++) {
          const v = corner(fig.c, ix / CELLS, iy / CELLS);
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
      const at = (ix, iy) => pts[iy * (CELLS + 1) + ix];
      const src = (ix, iy) => [sx + (ix / CELLS) * FIGURE_TILE, sy + (iy / CELLS) * FIGURE_TILE];

      for (let iy = 0; iy < CELLS; iy++) {
        for (let ix = 0; ix < CELLS; ix++) {
          const s00 = src(ix, iy), s10 = src(ix + 1, iy);
          const s11 = src(ix + 1, iy + 1), s01 = src(ix, iy + 1);
          const d00 = at(ix, iy), d10 = at(ix + 1, iy);
          const d11 = at(ix + 1, iy + 1), d01 = at(ix, iy + 1);
          // A cell with a corner behind the viewer has no honest shape on
          // screen; the rest of the figure is still perfectly drawable.
          if (d00 && d10 && d11) triangle(ctx, sheet, s00, s10, s11, d00, d10, d11);
          if (d00 && d11 && d01) triangle(ctx, sheet, s00, s11, s01, d00, d11, d01);
        }
      }
      drawn++;
    }
    ctx.restore();
    return drawn;
  };

  return layer;
}
