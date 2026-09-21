import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTrack } from '../site/src/skydraw.js';
import { basisFromAim, focalLength, altAzToVector } from '../site/src/skyview.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A DASHED LINE WITH NO NAME ON IT IS JUST A LINE.
//
// The Moon, the station and each planet are drawn as dashed paths in their own
// colour, and the name is repeated along the length on purpose -- one label at
// one end leaves you asking "which of these is Jupiter" wherever else you
// happen to be looking.
//
// The repeat interval put the FIRST label half an interval in, so that the
// names spread evenly along a long path. With labelEvery at 14 that is index 7
// of the ON-SCREEN points -- so a track that only clipped the corner of the
// view, or any track at a tight zoom, had fewer visible points than the offset
// and the loop ran zero times. The path was drawn and left anonymous.
//
// These drive the real drawing function against a recording context rather
// than reading the source for the line that fixes it, because what matters is
// "a visible track gets a name", not how the index is computed.

/** A canvas 2D context that records the text it was asked to draw. */
function recordingCtx() {
  const labels = [];
  return {
    labels,
    // state the drawing code sets; harmless to accept and ignore
    lineWidth: 0, strokeStyle: '', fillStyle: '', font: '', globalAlpha: 1,
    textAlign: '', textBaseline: '',
    dashes: [],
    save() {}, restore() {},
    setLineDash(d) { if (d && d.length) this.dashes.push(d.slice()); },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    // Names are now spaced by distance on screen, so the drawing code has to
    // ask how wide one is. A rough average width per character is plenty --
    // this measures the SPACING rule, not the font.
    measureText(text) { return { width: text.length * 6 }; },
    fillText(text, x, y) { labels.push({ text, x, y }); },
  };
}

const W = 720, H = 480;
const CX = W / 2, CY = H / 2;
const FOCAL = focalLength(W, 65);
const BASIS = basisFromAim(0, 45);          // looking north, half way up

/** A track of `n` points marching across the middle of the view. */
function trackAcrossView(n, label = 'Jupiter') {
  const points = [];
  for (let i = 0; i < n; i++) {
    // A few degrees either side of the aim, so every point lands on screen.
    const az = -10 + (20 * i) / Math.max(1, n - 1);
    points.push({ v: altAzToVector(45, az), up: true, at: new Date() });
  }
  return { points, colour: '#e8d27a', label };
}

test('a track with fewer points than the label offset is still named', () => {
  // THE BUG: 3 visible points, first label wanted at index 7, nothing drawn.
  const ctx = recordingCtx();
  drawTrack(ctx, trackAcrossView(3), BASIS, FOCAL, CX, CY, W, H, false);
  assert.ok(ctx.labels.length >= 1,
    'a visible track was drawn with no name on it at all');
  assert.equal(ctx.labels[0].text, 'Jupiter');
});

test('a two-point track — the shortest thing that draws — is named', () => {
  const ctx = recordingCtx();
  drawTrack(ctx, trackAcrossView(2), BASIS, FOCAL, CX, CY, W, H, false);
  assert.ok(ctx.labels.length >= 1, 'the shortest drawable track lost its name');
});

test('a long track still gets its names spread along it', () => {
  // The fix must not collapse to "one label, at the start". The point of
  // repeating is that the name is near wherever you are looking.
  const ctx = recordingCtx();
  drawTrack(ctx, trackAcrossView(60), BASIS, FOCAL, CX, CY, W, H, false);
  assert.ok(ctx.labels.length >= 3,
    `a 60-point track should carry several names, got ${ctx.labels.length}`);
  const xs = ctx.labels.map((l) => l.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 50,
    'the names are bunched together instead of spread along the path');
});

test('a track with nothing on screen is not named', () => {
  // The clamp must not label a path that is entirely behind you: a name with
  // no line under it is worse than no name.
  const ctx = recordingCtx();
  const behind = {
    points: [0, 1, 2].map(() => ({ v: altAzToVector(45, 180), up: true })),
    colour: '#e8d27a',
    label: 'Jupiter',
  };
  drawTrack(ctx, behind, BASIS, FOCAL, CX, CY, W, H, false);
  assert.equal(ctx.labels.length, 0,
    'a track with no visible points must not be labelled');
});

test('an unnamed track draws no text', () => {
  const ctx = recordingCtx();
  const t = trackAcrossView(20);
  delete t.label;
  drawTrack(ctx, t, BASIS, FOCAL, CX, CY, W, H, false);
  assert.equal(ctx.labels.length, 0);
});

// --- names must not pile up --------------------------------------------------
//
// Reported from the app, with a screenshot: "Uranus" drawn over "Uranus" over
// "Uranus" over "Mars", in one unreadable heap.
//
// The names used to be placed every Nth on-screen point, which assumes the
// samples are spread evenly across the picture. They are not. A planet is
// sampled every three days over six months, and at a retrograde stationary
// point -- the turn of the loop -- it barely moves for weeks. A dozen samples
// then land within a few pixels of each other and every one of them that hits
// the interval writes the name in the same place.

/** A track whose samples barely move: a planet at a stationary point. */
function bunchedTrack(n, label) {
  const points = [];
  for (let i = 0; i < n; i++) {
    // A fifth of a degree across the whole run -- a couple of pixels.
    points.push({ v: altAzToVector(45 + i * 0.01, 0.2 * (i / n)), up: true });
  }
  return { points, colour: '#ffe9a0', label };
}

test('a planet dawdling in one spot is named once, not a dozen times', () => {
  const ctx = recordingCtx();
  drawTrack(ctx, bunchedTrack(24, 'Uranus'), BASIS, FOCAL, CX, CY, W, H, false);
  assert.equal(ctx.labels.length, 1,
    `24 samples in a couple of pixels drew ${ctx.labels.length} names`);
});

test('no two names are ever written on top of each other', () => {
  const ctx = recordingCtx();
  drawTrack(ctx, trackAcrossView(60), BASIS, FOCAL, CX, CY, W, H, false);
  for (let i = 0; i < ctx.labels.length; i++) {
    for (let j = i + 1; j < ctx.labels.length; j++) {
      const a = ctx.labels[i], b = ctx.labels[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 20,
        `two names ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(1)}px apart`);
    }
  }
});

test('two different paths crossing do not write over each other', () => {
  // The other half of the report: "Uranus" over "Mars". Each track is drawn by
  // its own call, so the only way they can know about each other is the list
  // of placed names that the frame passes through all of them.
  const ctx = recordingCtx();
  const placed = [];
  drawTrack(ctx, bunchedTrack(24, 'Uranus'), BASIS, FOCAL, CX, CY, W, H, false, placed);
  drawTrack(ctx, bunchedTrack(24, 'Mars'), BASIS, FOCAL, CX, CY, W, H, false, placed);
  const [a, b] = ctx.labels;
  assert.equal(ctx.labels.length, 2, 'each track should still get its one name');
  // They genuinely occupy the same few pixels of sky, so the second is lifted
  // clear rather than laid on top: stacked reads, overlaid does not.
  const fontPx = Math.round(H / 38);
  assert.ok(Math.abs(a.y - b.y) >= fontPx,
    `"${a.text}" and "${b.text}" are only ${Math.abs(a.y - b.y).toFixed(1)}px `
    + 'apart vertically, which is on top of each other');
});

test('a name still appears even when the spot is crowded', () => {
  // The floor from #52 has to survive the new ceiling: if every candidate is
  // blocked, one overlap beats an anonymous line.
  const ctx = recordingCtx();
  const placed = [];
  for (const name of ['Uranus', 'Mars', 'Saturn', 'Neptune']) {
    drawTrack(ctx, bunchedTrack(24, name), BASIS, FOCAL, CX, CY, W, H, false, placed);
  }
  assert.equal(ctx.labels.length, 4, 'every track must be named exactly once');
  assert.deepEqual(ctx.labels.map((l) => l.text).sort(),
    ['Mars', 'Neptune', 'Saturn', 'Uranus']);
});

// --- the dash has to stay a dash ---------------------------------------------

test('the dash scales with the canvas, like the line it is made of', () => {
  // The width was scaled and the dash was not, so on a phone -- two or three
  // times 720 wide -- the stroke thickened while each dash stayed the same few
  // pixels long, and a broken line turned into a row of blocks.
  const small = recordingCtx();
  drawTrack(small, { ...trackAcrossView(10), dash: [10, 8] },
    BASIS, FOCAL, CX, CY, 720, 480, false);
  const big = recordingCtx();
  drawTrack(big, { ...trackAcrossView(10), dash: [10, 8] },
    BASIS, focalLength(2160, 65), 1080, 720, 2160, 1440, false);
  assert.deepEqual(small.dashes[0], [10, 8], 'at 720 wide the dash is itself');
  assert.deepEqual(big.dashes[0], [30, 24],
    'at three times the width the dash must be three times as long');
});

test('every dash is long enough to read as a line, not a block', () => {
  // The preference this was changed for: thin horizontal lines, not chunky
  // squares. A dash wants to be several times longer than the stroke is thick.
  const styles = readFileSync(
    fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
  const block = styles.slice(styles.indexOf('const TRACK_STYLE = {'),
    styles.indexOf('};', styles.indexOf('const TRACK_STYLE = {')));
  const rows = [...block.matchAll(/dash: \[(\d+), \d+\], width: ([\d.]+)/g)];
  assert.equal(rows.length, 3, 'expected three styled paths');
  for (const [, on, width] of rows) {
    assert.ok(Number(on) / Number(width) >= 3,
      `a dash ${on} long on a stroke ${width} thick is a block, not a dash`);
  }
});
