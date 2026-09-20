// Drawing the live sky view. The maths lives in skyview.js; this only paints.

import {
  deviceBasis, basisFromAim, applyScreenAngle, altAzToVector, vectorToAltAz,
  focalLength, projectToScreen, starRadius, starColour,
} from './skyview.js';
import { CONSTELLATIONS } from './data/constellations.js';

const NAMED = new Map([
  [424, 'Polaris'], [4301, 'Dubhe'], [4295, 'Merak'], [5191, 'Alkaid'],
  [5054, 'Mizar'], [4905, 'Alioth'], [168, 'Schedar'], [21, 'Caph'],
  [5563, 'Kochab'], [7228, 'σ Oct'], [4730, 'Acrux'], [4763, 'Gacrux'],
  [5459, 'Rigil Kent'], [5267, 'Hadar'], [2943, 'Procyon'], [2491, 'Sirius'],
  [7001, 'Vega'], [7557, 'Altair'], [1708, 'Capella'], [472, 'Mirach'],
]);

const CARDINALS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
                   [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];

/**
 * Paint one frame.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {Array}  o.sky        from buildSkyVectors()
 * @param {number} o.alpha      device orientation, degrees
 * @param {number} o.beta
 * @param {number} o.gamma
 * @param {number} o.declination  magnetic declination, east positive
 * @param {number} o.targetAlt  the pole's altitude
 * @param {number} o.targetAz   the pole's azimuth, 0 or 180
 * @param {string} o.targetName
 * @param {number} o.w
 * @param {number} o.h
 * @param {number} [o.fov]      horizontal field of view, degrees
 * @param {boolean} [o.night]
 * @returns {{aimedAlt:number, aimedAz:number, targetOnScreen:boolean}}
 */
export function drawSkyView(ctx, o) {
  const { sky, alpha, beta, gamma, declination, targetAlt, targetAz,
          targetName, w, h, fov = 65, night = false } = o;

  const ink = night ? '#ff0000' : '#e8ecf4';
  const dim = night ? '#8b0000' : '#5b6b86';
  const accent = night ? '#ff0000' : '#7CFFB2';

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = night ? '#000000' : '#05070d';
  ctx.fillRect(0, 0, w, h);

  // Either the device is aimed somewhere, or the buttons are. Same projection
  // either way -- pointing is never the only way to look at the sky.
  // The screen does not turn when the device does, so a landscape phone needs
  // the picture rotated back or every left/right instruction is ninety degrees
  // wrong. Manual aim is already in screen terms and needs no correction.
  const basis = o.aim
    ? basisFromAim(o.aim.az, o.aim.alt, 0)
    : applyScreenAngle(deviceBasis(alpha, beta, gamma, declination),
                       o.screenAngle || 0);
  const focal = focalLength(w, fov);
  const cx = w / 2, cy = h / 2;
  const aimed = vectorToAltAz(basis.forward);

  // The Milky Way, first, because it is the sky rather than something drawn on
  // it. Soft additive blobs rather than a filled polygon: a hard-edged band
  // reads as a drawn shape, and the real thing has no edge.
  if (o.milkyWay && o.milkyWay.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const blob = Math.max(18, w / 9);
    for (const p of o.milkyWay) {
      const q = projectToScreen(p.v, basis, focal);
      if (!q) continue;
      const x = cx + q.x, y = cy + q.y;
      if (x < -blob || x > w + blob || y < -blob || y > h + blob) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, blob);
      const a = p.a * (night ? 0.10 : 0.16);
      g.addColorStop(0, night ? `rgba(150,0,0,${a})` : `rgba(150,170,225,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - blob, y - blob, blob * 2, blob * 2);
    }
    ctx.restore();
  }

  // The horizon, drawn as a real projected curve rather than a straight rule:
  // under a rectilinear projection it only looks straight when you are level,
  // and faking that is how a view starts lying about which way is down.
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let az = 0; az <= 360; az += 2) {
    const p = projectToScreen(altAzToVector(0, az), basis, focal);
    if (!p) { started = false; continue; }
    const x = cx + p.x, y = cy + p.y;
    if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
  }
  ctx.stroke();

  // Ground below the horizon, so "down" is unmistakable.
  ctx.save();
  ctx.globalAlpha = night ? 0.35 : 0.5;
  for (let az = 0; az <= 360; az += 6) {
    const a = projectToScreen(altAzToVector(0, az), basis, focal);
    const b = projectToScreen(altAzToVector(-12, az), basis, focal);
    if (!a || !b) continue;
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + a.x, cy + a.y);
    ctx.lineTo(cx + b.x, cy + b.y);
    ctx.stroke();
  }
  ctx.restore();

  // Cardinal points on the horizon.
  ctx.font = `600 ${Math.round(h / 26)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [az, label] of CARDINALS) {
    const p = projectToScreen(altAzToVector(0, az), basis, focal);
    if (!p) continue;
    const x = cx + p.x, y = cy + p.y;
    if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
    ctx.fillStyle = label.length === 1 ? ink : dim;
    ctx.fillText(label, x, y + h / 34);
  }

  // Constellation figures. Drawn before the stars so the lines pass behind
  // them rather than across their faces.
  const drawn = new Map();
  if (o.constellations) {
    ctx.save();
    ctx.strokeStyle = night ? '#7a0000' : '#4a6a9c';
    ctx.lineWidth = Math.max(1, w / 620);
    ctx.globalAlpha = 0.85;
    for (const s2 of sky) drawn.set(s2.hr, s2.v);
    for (const key of Object.keys(CONSTELLATIONS)) {
      for (const [a, b] of CONSTELLATIONS[key].lines) {
        const va = drawn.get(a), vb = drawn.get(b);
        if (!va || !vb) continue;
        const pa = projectToScreen(va, basis, focal);
        const pb = projectToScreen(vb, basis, focal);
        if (!pa || !pb) continue;          // never join across the horizon
        ctx.beginPath();
        ctx.moveTo(cx + pa.x, cy + pa.y);
        ctx.lineTo(cx + pb.x, cy + pb.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Stars.
  let labelled = 0;
  for (const s of sky) {
    const p = projectToScreen(s.v, basis, focal);
    if (!p) continue;
    const x = cx + p.x, y = cy + p.y;
    if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
    const r = starRadius(s.mag);
    ctx.fillStyle = starColour(s.bv, night);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Name only the bright, well-known ones, and only a few: a sky full of
    // labels is unreadable exactly when you are trying to find one thing.
    if (labelled < 7 && s.mag < 2.6 && NAMED.has(s.hr)) {
      labelled += 1;
      ctx.fillStyle = dim;
      ctx.font = `500 ${Math.round(h / 34)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(NAMED.get(s.hr), x + r + 5, y);
      ctx.textAlign = 'center';
    }
  }

  // The target: the pole itself, ringed, because that is what you align to.
  const tp = projectToScreen(altAzToVector(targetAlt, targetAz), basis, focal);
  let onScreen = false;
  if (tp) {
    const x = cx + tp.x, y = cy + tp.y;
    onScreen = x > 0 && x < w && y > 0 && y < h;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, h / 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - h / 9, y); ctx.lineTo(x - h / 22, y);
    ctx.moveTo(x + h / 22, y); ctx.lineTo(x + h / 9, y);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = `600 ${Math.round(h / 24)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(targetName, x, y - h / 11);
  }

  // Off-screen pointer, so the target is never simply absent with no hint
  // which way to move. An empty sky and a wrong sky look identical.
  if (!onScreen) {
    const t = altAzToVector(targetAlt, targetAz);
    const rx = t[0] * basis.right[0] + t[1] * basis.right[1] + t[2] * basis.right[2];
    const ry = t[0] * basis.up[0] + t[1] * basis.up[1] + t[2] * basis.up[2];
    const ang = Math.atan2(-ry, rx);
    const rad = Math.min(w, h) * 0.36;
    const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-10, 9); ctx.lineTo(-10, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  return { aimedAlt: aimed.alt, aimedAz: aimed.az, targetOnScreen: onScreen };
}
