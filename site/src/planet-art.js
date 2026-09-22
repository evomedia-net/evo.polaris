// The planets as little worlds rather than coloured dots.
//
// WHY THIS EXISTS. A planet was a dot sized from its magnitude: correct, and
// indistinguishable from the ten thousand other dots except by its caption.
// The thing that makes Jupiter recognisable through any telescope is its
// belts, and Mars its dark maria, and none of that survived being a circle.
//
// WHAT IS HONEST HERE, AND WHAT IS NOT. The POSITION is exact, as everywhere
// else in this app. Two things are not, and both are the same kind of
// compromise the Moon already makes and says so:
//
//   * SIZE. A planet is arcseconds across. At any field this app draws, that
//     is a fraction of a pixel, so the disc is drawn larger than life -- the
//     way a chart exaggerates a symbol it needs you to recognise.
//   * WHICH FACE. The texture is the planet's whole map, drawn with an
//     arbitrary central meridian. Showing the hemisphere actually turned
//     toward Earth at this second needs each planet's rotation model, which
//     this app does not carry. So Jupiter's belts are in the right places
//     and its Great Red Spot is not, and the docs say so rather than leaving
//     it to be discovered.
//
// The phase IS real: Mercury and Venus show crescents, from the same phase
// angle the magnitude calculation already uses, with the lit side measured
// against the projection exactly as the Moon's is.
//
// THE DISCS ARE CACHED. The sky repaints every frame while the phone is
// moving, and sampling a sphere pixel by pixel seven times a frame is how a
// live view turns into a slideshow. Each planet is rendered once per radius
// and reused; the phase shadow is drawn over the top, so it stays live
// without invalidating anything.

const SRC = './src/data/planets.webp';

// The atlas rows, in the order build-planet-textures.py writes them. Anything
// not in this list has no texture and falls back to a flat disc -- Pluto, and
// anything added to the app before its row exists.
export const ROWS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const TILE_W = 128, TILE_H = 64;

export const CREDIT = 'Planets: Solar System Scope';

/**
 * Sample one atlas row onto a sphere, into a canvas of its own.
 *
 * The disc is orthographic: a pixel at (x, y) from the centre, in units of
 * the radius, sits on the sphere at depth z = sqrt(1 - x^2 - y^2), and the
 * latitude and longitude follow from there. Longitude is taken from x and z
 * so the texture compresses toward the limb the way a real sphere does --
 * the detail crowding at the edges is most of what makes it read as round
 * rather than as a sticker.
 *
 * A one-pixel alpha feather at the rim: without it the disc has the hard
 * stair-stepped edge of a circle drawn by hand, which at twenty pixels is
 * the whole shape.
 */
function renderDisc(img, row, r, night) {
  const size = Math.max(2, Math.ceil(r * 2));
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  // The row, at its own resolution, to sample from.
  const tile = document.createElement('canvas');
  tile.width = TILE_W; tile.height = TILE_H;
  const tctx = tile.getContext('2d');
  tctx.drawImage(img, 0, row * TILE_H, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
  const src = tctx.getImageData(0, 0, TILE_W, TILE_H).data;

  const out = ctx.createImageData(size, size);
  const dst = out.data;
  const mid = size / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5 - mid) / r;
      const y = (py + 0.5 - mid) / r;
      const d2 = x * x + y * y;
      const o = (py * size + px) * 4;
      if (d2 > 1) { dst[o + 3] = 0; continue; }

      const z = Math.sqrt(1 - d2);
      // Screen y runs down, so -y is north.
      const lat = Math.asin(Math.max(-1, Math.min(1, -y)));
      const lon = Math.atan2(x, z);

      let sx = Math.floor(((lon / Math.PI + 1) / 2) * TILE_W) % TILE_W;
      if (sx < 0) sx += TILE_W;
      const sy = Math.min(TILE_H - 1, Math.max(0,
        Math.floor((0.5 - lat / Math.PI) * TILE_H)));
      const s = (sy * TILE_W + sx) * 4;

      if (night) {
        // Night Mode is pure red on black: luminance only, no hue at all.
        const lum = (src[s] * 0.299 + src[s + 1] * 0.587 + src[s + 2] * 0.114);
        dst[o] = Math.min(255, lum * 1.15); dst[o + 1] = 0; dst[o + 2] = 0;
      } else {
        dst[o] = src[s]; dst[o + 1] = src[s + 1]; dst[o + 2] = src[s + 2];
      }
      // LIMB DARKENING. A sphere falls off toward its edge; without it the
      // disc is evenly bright to the rim and reads as a sticker rather than
      // a ball. Gentle on purpose -- z^0.35 rather than the physical curve,
      // which at twenty pixels would eat most of the texture.
      const shade = 0.55 + 0.45 * Math.pow(z, 0.35);
      dst[o] *= shade; dst[o + 1] *= shade; dst[o + 2] *= shade;

      // Feather the last pixel of the rim rather than cutting it square.
      const edge = (1 - Math.sqrt(d2)) * r;
      dst[o + 3] = edge < 1 ? Math.round(255 * Math.max(0, edge)) : 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/**
 * The texture layer. Answers false from draw() whenever it cannot paint --
 * no image yet, no row for that planet, a canvas that threw -- and the
 * caller then draws the dot it always drew. The planets are never absent.
 */
export function createPlanetArt({ forceOff = false } = {}) {
  const layer = { mode: 'loading', ready: null };
  const cache = new Map();
  let img = null;

  layer.ready = new Promise((resolve) => {
    if (forceOff) { layer.mode = 'off'; resolve(false); return; }
    const el = new Image();
    el.onload = () => { img = el; layer.mode = 'texture'; resolve(true); };
    el.onerror = () => { layer.mode = 'off'; resolve(false); };
    el.src = SRC;
  });

  /**
   * @param {object} p        the planet: name, and phase if it has one
   * @param {number} r        radius on screen, in canvas pixels
   * @param {number} limbAngle where the lit side points, radians, screen frame
   * @returns {boolean} whether anything was painted
   */
  layer.draw = function draw(ctx, p, x, y, r, { night = false, illuminated = 1, limbAngle = 0, ringTilt = null, ringAngle = 0 } = {}) {
    if (!img || r < 3) return false;              // below a few pixels a dot is honest and cheaper
    const row = ROWS.indexOf(p.name);
    if (row < 0) return false;

    const key = `${p.name}|${Math.round(r * 2)}|${night ? 'n' : 'd'}`;
    let disc = cache.get(key);
    if (!disc) {
      try { disc = renderDisc(img, row, r, night); } catch { return false; }
      // A handful of planets at a handful of sizes; the cap is only here so
      // a pinch-zoom that sweeps every radius cannot grow it without end.
      if (cache.size > 64) cache.clear();
      cache.set(key, disc);
    }

    ctx.save();
    ctx.translate(x, y);

    // SATURN'S RINGS, WHICH ARE MOST OF WHAT MAKES SATURN RECOGNISABLE. The
    // texture maps carry the globe alone, so a ringless Saturn is a cream
    // ball nobody would name. They are an ellipse squashed by how far the
    // ring plane is opened toward Earth -- which genuinely changes, from
    // edge-on (a line across the planet, as in 2025) to about 27 degrees --
    // so the tilt is computed each tick rather than fixed. A drawn-in oval
    // would be wrong for most of Saturn's orbit and absurd at the crossings.
    //
    // The far half is drawn BEHIND the globe and the near half in front,
    // which is the only thing that makes a ring read as encircling rather
    // than as a hoop lying on top of a circle.
    const rings = p.name === 'Saturn' && ringTilt !== null && r >= 5;
    const ringPath = (near) => {
      ctx.save();
      ctx.rotate(ringAngle);
      ctx.scale(1, Math.max(0.04, Math.abs(Math.sin(ringTilt))));
      ctx.beginPath();
      // The visible system runs from about 1.24 to 2.27 Saturn radii.
      const a0 = near ? 0 : Math.PI;
      ctx.arc(0, 0, r * 2.27, a0, a0 + Math.PI, false);
      ctx.arc(0, 0, r * 1.24, a0 + Math.PI, a0, true);
      ctx.closePath();
      ctx.fillStyle = night ? 'rgba(200,0,0,0.72)' : 'rgba(230,216,182,0.80)';
      ctx.fill();
      ctx.restore();
    };
    if (rings) ringPath(false);

    ctx.drawImage(disc, -disc.width / 2, -disc.height / 2);
    if (rings) ringPath(true);

    // THE UNLIT PART, for the two planets that show a phase worth seeing.
    // Drawn as a shadow over the texture rather than by masking it, so the
    // cached disc stays valid as the phase changes.
    if (illuminated < 0.98) {
      ctx.rotate(limbAngle);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = night ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.78)';
      ctx.beginPath();
      // The terminator is an ellipse whose width is how far the shadow
      // reaches across the disc; the same shape the Moon's face uses.
      const k = 1 - 2 * illuminated;               // +1 new, -1 full
      ctx.ellipse(0, 0, r * Math.abs(k), r, 0, -Math.PI / 2, Math.PI / 2, k < 0);
      ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, false);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return true;
  };

  return layer;
}
