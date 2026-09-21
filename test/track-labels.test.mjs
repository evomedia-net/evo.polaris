import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTrack } from '../site/src/skydraw.js';
import { basisFromAim, focalLength, altAzToVector } from '../site/src/skyview.js';

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
    save() {}, restore() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
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
