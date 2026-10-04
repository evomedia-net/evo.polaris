import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTrack } from '../site/src/skydraw.js';
import { basisFromAim, altAzToVector } from '../site/src/skyview.js';

// A PATH IS DASHED AT EVERY ZOOM, ON EVERY SCREEN (#207).
//
// "iss line is no longer dashed" -- "its ok on phone, not pc". The path was
// stroked one two-degree segment at a time, and a dash pattern starts again
// at every stroke; on a desktop canvas, or zoomed out, a segment came out
// shorter than one dash, so every segment was all dash and no gap. A run of
// the path on one side of the horizon is one stroke now, so the pattern flows
// along it whatever the segment length.

function stub() {
  const calls = { stroke: 0, lineTo: 0, moveTo: 0, dash: null };
  return {
    calls,
    globalAlpha: 1, strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '', font: '', fillStyle: '',
    textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    setLineDash(d) { calls.dash = d; },
    moveTo() { calls.moveTo += 1; }, lineTo() { calls.lineTo += 1; }, stroke() { calls.stroke += 1; },
  };
}

const W = 1600, H = 900;
const basis = basisFromAim(0, 30);
// The sky view's own projection: half the width over tan(half the field).
const focal = (W / 2) / Math.tan((65 / 2) * Math.PI / 180);

/** A path along the horizon-ish band, `n` samples 2 degrees apart, with `up` per sample. */
function track(n, upAt = () => true) {
  return {
    label: 'ISS', colour: '#7fd4ff', dash: [20, 10], width: 1.5,
    points: Array.from({ length: n }, (_, i) => ({ v: altAzToVector(20, -20 + i * 2), up: upAt(i) })),
  };
}

test('a path wholly above the horizon is one stroke, not one per segment', () => {
  const ctx = stub();
  drawTrack(ctx, track(21), basis, focal, W / 2, H / 2, W, H, false);
  assert.equal(ctx.calls.stroke, 1, `${ctx.calls.stroke} strokes: the dash pattern restarts at each`);
  assert.equal(ctx.calls.lineTo, 20, 'every segment is still drawn');
  assert.ok(ctx.calls.dash && ctx.calls.dash.every((d) => d > 0), 'and it is dashed');
});

test('crossing the horizon starts a second run, and only that', () => {
  const ctx = stub();
  drawTrack(ctx, track(21, (i) => i < 10), basis, focal, W / 2, H / 2, W, H, false);
  assert.equal(ctx.calls.stroke, 2, 'one run above, one below');
});
