import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSkyView } from '../site/src/skydraw.js';

// THE STATION HAS A MARKER WHEREVER IT IS (#203).
//
// "ISS has no icon, or even a dot". With the station below the horizon the
// ring followed it down and circled nothing, because the marker was drawn
// only above the horizon. It is drawn everywhere now, as a little station --
// a body and two solar wings -- under the see-through ground when it is
// underfoot, and its caption says where it is unless the ring already does.

function stubCtx() {
  const texts = [];
  const arcs = [];
  return {
    texts, arcs,
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, stroke() {}, moveTo() {}, lineTo() {},
    fill() {}, clearRect() {}, fillRect() {}, setLineDash() {}, clip() {},
    arc(x, y, r) { arcs.push({ x, y, r }); }, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t) { texts.push(String(t)); },
    strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
}

const W = 900, H = 600, REF = Math.min(W, H);

function frame(iss, targetName = 'Polaris') {
  const ctx = stubCtx();
  drawSkyView(ctx, {
    sky: [], constellations: null, milkyWay: null, tracks: null, planets: null, moon: null, iss,
    aim: { az: 0, alt: 0 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
    targetAlt: 0, targetAz: 0, targetName, reticleR: 28,
    w: W, h: H, fov: 65, night: false,
  });
  return ctx;
}
const stationBody = (ctx) => ctx.arcs.filter((a) => Math.abs(a.r - REF / 90) < 1e-6);

test('a station below the horizon is drawn, and its caption says so', () => {
  const ctx = frame({ alt: -10, az: 5, sunlit: true, up: false });
  assert.equal(stationBody(ctx).length, 1, 'the station body must be drawn under the ground');
  assert.ok(ctx.texts.includes('ISS (below the horizon)'), ctx.texts.join(' | '));
});

test('above the horizon it says whether it can be seen', () => {
  assert.ok(frame({ alt: 10, az: 5, sunlit: true, up: true }).texts.includes('ISS'));
  assert.ok(frame({ alt: 10, az: 5, sunlit: false, up: true }).texts.includes('ISS (in shadow)'));
});

test('with the ring on it, the station is still drawn but the ring does the naming', () => {
  const ctx = frame({ alt: -10, az: 5, sunlit: true, up: false }, 'ISS');
  assert.equal(stationBody(ctx).length, 1, 'the marker must be there inside the ring');
  assert.equal(ctx.texts.filter((t) => t.startsWith('ISS')).length, 1, 'one name: the ring caption');
});
