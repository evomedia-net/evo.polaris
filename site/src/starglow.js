// A BRIGHT STAR IS A GLOW WITH SPIKES, NOT A BIGGER DOT.
//
// Kelly, looking at OpenSpace's sky: "some of the stars had streaks or had
// some kind of filters on them and they looked fairly realistic and a lot
// nicer." That is a point-spread sprite -- a soft core, a small halo, and a
// pair of crossed spikes -- drawn in place of the flat disc.
//
// ONLY THE BRIGHT ONES, and that is the whole design. A halo on every star
// swells the faint ones until the sky reads as fog and the brightness
// ordering -- the one thing the map uses to say which star you are looking at
// -- is lost. Below GLOW_MAX_MAG a star stays the dot it always was.
//
// THE SPIKES POINT A DIFFERENT WAY ON EVERY STAR. "I would make it so that
// they aren't all uniform facing the same direction, give them each a random
// rotation." Random ONCE, not per frame: the angle comes from the star's own
// catalogue number, so it is the same angle on every draw. Rolled per frame
// the spikes would spin while you panned, which is the one thing a fixed sky
// must never do.
//
// THE SPIKES ARE NOT REAL. They come from the vanes holding a telescope's
// mirror, and no eye has ever seen one. They are a symbol for "this star is
// bright", on the same terms as the Moon being drawn larger than life: the
// POSITION stays exact and the caption says the size is not. That is also why
// rotating them randomly costs nothing in honesty -- a real spike pattern is
// identical on every star in the frame, so a varied one is visibly a drawing.

/** How far down the magnitude scale the glow reaches. Fainter than this is a dot. */
export const GLOW_MAX_MAG = 3.5;

/** How much bigger the sprite is than the dot it replaces. */
export const GLOW_SCALE = 4.6;

/**
 * How many distinct spike orientations are pre-rendered.
 *
 * The cross has four arms at right angles, so it repeats every quarter turn:
 * eight steps across 90 degrees is eight genuinely different stars, and a
 * ninth would be the first one again.
 */
export const SPIKE_ANGLES = 8;

/** The sprite's side in device pixels, before it is scaled down to the star. */
const SPRITE = 64;

/**
 * Which spike angle this star wears, from its catalogue number.
 *
 * Deterministic on purpose. A star has to look the same in this frame as in
 * the last one, and the HR number is the only thing about it that never
 * changes. Knuth's multiplicative hash spreads consecutive catalogue numbers
 * -- which are ordered by position, so neighbours in the sky are neighbours
 * in the list -- across the whole range, instead of handing a constellation
 * eight stars in a tidy rotating fan.
 */
export function spikeAngleFor(hr) {
  const n = Number(hr);
  if (!Number.isFinite(n)) return 0;
  const h = (Math.abs(Math.trunc(n)) * 2654435761) % 4294967296;
  return Math.floor((h / 4294967296) * SPIKE_ANGLES) % SPIKE_ANGLES;
}

/**
 * One sprite: core, halo, spikes, in one colour.
 *
 * NIGHT MODE IS PURE RED AND HAS ITS OWN STOPS. Everywhere else the core runs
 * to white and the halo carries a little blue-grey, which is what makes it
 * read as light rather than as paint. Both of those put green and blue on the
 * screen, and Night Mode's whole promise is that it does not -- so at night
 * the same shape is drawn in one channel, fading by transparency instead of
 * by lightening. test/night-* holds every night colour to #xx0000.
 */
function sprite(colour, night) {
  const c = document.createElement('canvas');
  c.width = SPRITE; c.height = SPRITE;
  const g = c.getContext('2d');
  const m = SPRITE / 2;
  g.globalCompositeOperation = 'lighter';

  // The halo stops well inside the sprite: a glow that reached the edge was
  // the "fog" version, and this is the half Kelly asked to cut back.
  const R = m * 0.62;
  const rg = g.createRadialGradient(m, m, 0, m, m, R);
  if (night) {
    rg.addColorStop(0, 'rgba(255, 0, 0, 1)');
    rg.addColorStop(0.14, 'rgba(204, 0, 0, 0.95)');
    rg.addColorStop(0.45, 'rgba(204, 0, 0, 0.25)');
    rg.addColorStop(1, 'rgba(204, 0, 0, 0)');
  } else {
    // THE WHITE CORE IS A POINT, NOT A DISC. At 0.14 it swallowed the star's
    // own colour: Dubhe is visibly orange as a dot and came out white as a
    // glow, which throws away what B-V was telling you. The eye does see a
    // white centre on a bright star, so it stays -- just small enough that
    // the colour is what the star reads as.
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.07, colour);
    rg.addColorStop(0.45, 'rgba(120, 120, 140, 0.24)');
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  g.fillStyle = rg;
  g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();

  const L = m * 0.92;
  const ink = night ? '#cc0000' : colour;
  const clear = night ? 'rgba(204, 0, 0, 0)' : 'rgba(0, 0, 0, 0)';
  g.globalAlpha = 0.85;
  for (const a of [0, Math.PI / 2]) {
    const x0 = m - L * Math.cos(a), y0 = m - L * Math.sin(a);
    const x1 = m + L * Math.cos(a), y1 = m + L * Math.sin(a);
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, clear);
    gr.addColorStop(0.5, ink);
    gr.addColorStop(1, clear);
    g.strokeStyle = gr;
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  return c;
}

/** The same sprite at every pre-rendered angle. */
function rotations(base) {
  const out = [];
  for (let i = 0; i < SPIKE_ANGLES; i++) {
    const c = document.createElement('canvas');
    c.width = SPRITE; c.height = SPRITE;
    const g = c.getContext('2d');
    g.translate(SPRITE / 2, SPRITE / 2);
    // A quarter turn covers every distinct cross; past that it repeats.
    g.rotate((i / SPIKE_ANGLES) * (Math.PI / 2));
    g.drawImage(base, -SPRITE / 2, -SPRITE / 2);
    out.push(c);
  }
  return out;
}

/**
 * The sprite sheets, built on demand and kept.
 *
 * KEYED BY THE COLOUR STRING ITSELF, not by a copy of the colour table. The
 * caller hands over whatever starColour() returned, so the glow cannot come
 * to disagree with the dot it replaces -- a second palette here would be a
 * second thing to keep in step, and the one that drifts is always the one
 * nobody is looking at.
 *
 * Six colours and eight angles is 48 canvases of 64 px, under a megabyte, and
 * none of them is built until a star of that colour is actually on screen.
 */
export function createStarGlow() {
  const cache = new Map();
  return {
    /** Every rotation of one colour, or null where there is no canvas to build on. */
    sheet(colour, night) {
      const key = `${night ? 'n' : 'd'}:${colour}`;
      if (cache.has(key)) return cache.get(key);
      let made = null;
      try { made = rotations(sprite(colour, night)); } catch { made = null; }
      cache.set(key, made);
      return made;
    },
    /**
     * Draw one star's glow, centred, at the radius its dot would have had
     * times GLOW_SCALE. Returns false if there was no sheet to draw.
     */
    draw(ctx, x, y, dotRadius, colour, hr, night) {
      const sheet = this.sheet(colour, night);
      if (!sheet) return false;
      const r = dotRadius * GLOW_SCALE;
      ctx.drawImage(sheet[spikeAngleFor(hr)], x - r, y - r, r * 2, r * 2);
      return true;
    },
    /** For tests and diagnostics: how many sheets have been built. */
    get size() { return cache.size; },
  };
}
