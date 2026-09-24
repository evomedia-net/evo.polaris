import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawSkyView } from '../site/src/skydraw.js';
import { altAzToVector } from '../site/src/skyview.js';

// NO TARGET IS A REAL ANSWER, AND THE PICTURE MUST GO ON WITHOUT ONE.
//
// "If I go in, expand tracking, and click on Polaris to stop tracking
// Polaris, you can't move anything, the screen freezes. If I select ISS,
// everything works. If I deselect ISS, then it freezes."
//
// aimTarget() returns null for "none" -- its own comment says nothing is a
// real answer -- and drawLiveSky dereferenced it, so every frame after a
// deselect threw before it could paint. The readout under the map kept
// changing (the arrows and the drag still steered), the picture never did.

const appJs = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

function recordingCtx() {
  const ops = [];
  const c = {
    ops, path: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', globalCompositeOperation: '', filter: '',
    lineCap: '', lineJoin: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() { c.path = []; }, closePath() {},
    moveTo(x, y) { c.path.push([x, y]); }, lineTo(x, y) { c.path.push([x, y]); },
    fill() { ops.push({ op: 'fill', style: String(c.fillStyle), pts: c.path.slice() }); },
    stroke() { ops.push({ op: 'stroke', style: String(c.strokeStyle), pts: c.path.slice() }); },
    arc(x, y, r) { ops.push({ op: 'arc', style: String(c.strokeStyle), x, y, r }); c.path.push([x, y]); },
    clearRect() {}, fillRect(x, y, w, h) { ops.push({ op: 'fillRect', style: String(c.fillStyle), x, y, w, h }); },
    setLineDash() {}, clip() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fillText(t, x, y) { ops.push({ op: 'text', text: String(t), x, y }); }, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage() {},
  };
  return c;
}

const frame = (target) => {
  const ctx = recordingCtx();
  const painted = drawSkyView(ctx, {
    sky: [{ v: altAzToVector(20, 0), mag: 1.0, hr: 424 }],
    constellations: null, milkyWay: null, tracks: null, planets: null, moon: null, iss: null,
    aim: { az: 0, alt: 0 }, alpha: 0, beta: 90, gamma: 0, declination: 0,
    ...target, reticleR: 28, w: 900, h: 600, fov: 65, night: false, ground: false,
  });
  return { ops: ctx.ops, painted };
};

test('a frame with no target draws, with no ring and no pointer', () => {
  // Exactly what drawLiveSky hands over once the fix is in: null, null, ''.
  const { ops, painted } = frame({ targetAlt: null, targetAz: null, targetName: '' });
  assert.ok(ops.length > 0, 'the sky must still be painted');
  assert.ok(ops.some((o) => o.op === 'arc'), 'the stars are still there');
  assert.equal(painted.targetOnScreen, true, '"nothing is off screen" is the honest answer for the pointer');
  assert.ok(!ops.some((o) => o.op === 'text' && o.text === 'Target'), 'no caption for no ring');
});

test('the same frame with a target has the ring, so the two really differ', () => {
  const { ops } = frame({ targetAlt: 20, targetAz: 0, targetName: 'Target' });
  assert.ok(ops.some((o) => o.op === 'text' && o.text === 'Target'), 'the caption is the ring being there');
});

test('drawLiveSky passes null for no target, instead of reading .alt of null', () => {
  const draw = appJs.slice(appJs.indexOf('function drawLiveSky('), appJs.indexOf('\n}', appJs.indexOf('function drawLiveSky(')));
  assert.match(draw, /targetAlt: target \? target\.alt : null,/);
  assert.match(draw, /targetAz: target \? target\.az : null,/);
  assert.ok(!/targetAlt: target\.alt/.test(draw), 'the dereference that froze the picture is gone');
  // And aimTarget really does answer null for none -- the case this guards.
  const at = appJs.slice(appJs.indexOf('function aimTarget('), appJs.indexOf('\n}', appJs.indexOf('function aimTarget(')));
  assert.match(at, /^function aimTarget\(issLook, what = guideTarget\) \{/,
    'the ring\'s own target unless asked about another');
  assert.match(at, /if \(what === 'none'\) return null;/);
});
