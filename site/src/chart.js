// Drawing: the circumpolar sky chart, and the polar-scope reticle.
//
// Both are decoration in the accessibility sense -- every number they show also
// exists as large text elsewhere on the page, and the canvases carry text
// alternatives. Nobody should need to read a graphic to align a mount.

import { projectAroundPole } from './astro.js';

// HR numbers verified against the shipped Bright Star Catalog, not memory.
export const ASTERISMS = {
  bigDipper: {
    name: 'The Big Dipper',
    stars: [4301, 4295, 4554, 4660, 4905, 5054, 5191],   // Dubhe..Alkaid
    lines: [[5191, 5054], [5054, 4905], [4905, 4660], [4660, 4554],
            [4554, 4295], [4295, 4301], [4301, 4660]],
  },
  cassiopeia: {
    name: 'Cassiopeia (the W)',
    stars: [21, 168, 264, 403, 542],
    lines: [[21, 168], [168, 264], [264, 403], [403, 542]],
  },
  littleDipper: {
    name: 'The Little Dipper',
    stars: [424, 5563, 5735],
    lines: [[424, 5563], [5563, 5735]],
  },
};

export const POLARIS_HR = 424;
const MERAK = 4295;        // beta UMa -- the back of the Dipper's bowl
const DUBHE = 4301;        // alpha UMa -- the lip; Merak->Dubhe points at Polaris

/** Star colour from B-V index. Kept muted so it survives red night mode. */
function starColour(bv) {
  if (bv < -0.1) return '#a8c8ff';
  if (bv < 0.3) return '#ffffff';
  if (bv < 0.6) return '#fff6e0';
  if (bv < 1.0) return '#ffe0a8';
  if (bv < 1.5) return '#ffc080';
  return '#ff9e6e';
}

function starRadius(mag, scale) {
  return Math.max(0.6, (6.2 - mag) * 0.42) * scale;
}

/**
 * Draw the sky around the north celestial pole.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {Array} opts.stars       parsed stars.json
 * @param {number} opts.lst        local sidereal time, hours
 * @param {number} opts.radiusDeg  half-width of the field, degrees from the pole
 * @param {number} opts.limitMag   faintest star to plot
 * @param {boolean} opts.night     red night-vision palette
 * @param {number} opts.size       canvas edge in CSS pixels
 * @param {boolean} opts.showPointer  draw the Merak->Dubhe->Polaris arrow
 */
export function drawSkyChart(ctx, opts) {
  const { stars, lst, radiusDeg = 50, limitMag = 5.2, night = false,
          size, showPointer = true } = opts;
  const R = size / 2 - 8;
  const cx = size / 2, cy = size / 2;
  const ink = night ? '#ff4a3a' : '#e8ecf4';
  const dim = night ? '#7a1e18' : '#3a4356';

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = night ? '#0a0000' : '#080b14';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  const place = (s) => {
    const p = projectAroundPole(s[0], s[1], lst, radiusDeg);
    return p && { x: cx + p.x * R, y: cy + p.y * R };
  };

  // declination rings every 10 deg, as a scale reference
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1;
  for (let d = 10; d <= radiusDeg; d += 10) {
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, (d / radiusDeg) * R, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const byHr = new Map();
  for (const s of stars) {
    if (s[2] > limitMag) continue;
    const p = place(s);
    if (!p) continue;
    byHr.set(s[4], { ...p, star: s });
    ctx.beginPath();
    ctx.fillStyle = night ? '#ff4a3a' : starColour(s[3]);
    ctx.arc(p.x, p.y, starRadius(s[2], size / 420), 0, Math.PI * 2);
    ctx.fill();
  }

  // constellation lines
  ctx.lineWidth = Math.max(1.2, size / 420);
  ctx.strokeStyle = night ? '#a8281e' : '#5b7fb8';
  for (const key of ['bigDipper', 'cassiopeia', 'littleDipper']) {
    for (const [a, b] of ASTERISMS[key].lines) {
      const pa = byHr.get(a), pb = byHr.get(b);
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  // the star-hop: extend Merak -> Dubhe about five times to reach Polaris
  const pol = byHr.get(POLARIS_HR);
  if (showPointer) {
    const m = byHr.get(MERAK), d = byHr.get(DUBHE);
    if (m && d && pol) {
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.lineWidth = Math.max(2, size / 240);
      ctx.strokeStyle = night ? '#ff8a3a' : '#ffb454';   // amber = the star-hop
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(pol.x, pol.y);
      ctx.stroke();
      ctx.restore();
      arrowHead(ctx, d, pol, night ? '#ff8a3a' : '#ffb454', size / 46);
    }
  }

  // Polaris last, so it sits on top of everything
  if (pol) {
    ctx.strokeStyle = night ? '#ffb0a0' : '#7CFFB2';     // green = the target
    ctx.lineWidth = Math.max(2, size / 220);
    ctx.beginPath();
    ctx.arc(pol.x, pol.y, size / 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = night ? '#ffb0a0' : '#7CFFB2';
    ctx.font = `600 ${Math.round(size / 24)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('Polaris', pol.x + size / 22, pol.y + size / 72);
  }

  // horizon hint: the pole's lower meridian points at the north horizon
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.75;
  ctx.font = `500 ${Math.round(size / 30)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('horizon below', cx, cy + R - size / 60);
  ctx.globalAlpha = 1;
}

function arrowHead(ctx, from, to, colour, len) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const tipX = to.x - Math.cos(a) * len * 1.5;
  const tipY = to.y - Math.sin(a) * len * 1.5;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(tipX + Math.cos(a) * len, tipY + Math.sin(a) * len);
  ctx.lineTo(tipX + Math.cos(a + 2.5) * len * 0.6, tipY + Math.sin(a + 2.5) * len * 0.6);
  ctx.lineTo(tipX + Math.cos(a - 2.5) * len * 0.6, tipY + Math.sin(a - 2.5) * len * 0.6);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw the iOptron AccuAlign reticle with Polaris marked where it belongs.
 *
 * The dial is a full circle numbered 0-12, so one dial hour is 30 degrees.
 * Concentric circles run 36'-44' (northern, Polaris) and 60'-70' (southern,
 * Sigma Octantis), per the SkyTracker Pro manual.
 */
export function drawReticle(ctx, { dialDecimal, radiusArcmin, size, night = false }) {
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 10;
  const innerMin = 34, outerMin = 46;          // arcmin span the ring covers
  const ink = night ? '#ff4a3a' : '#dfe6f2';
  const faint = night ? '#8a2018' : '#46506a';

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = night ? '#0a0000' : '#080b14';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // crosshairs
  ctx.strokeStyle = faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();

  const ringR = (arcmin) => ((arcmin - innerMin) / (outerMin - innerMin))
    * (R * 0.62) + R * 0.2;

  // the 36'-44' graduation circles
  for (let m = 36; m <= 44; m += 2) {
    ctx.strokeStyle = faint;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR(m), 0, Math.PI * 2);
    ctx.stroke();
  }

  // hour ticks: 12 major, 10-minute minor
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2 - Math.PI / 2;
    const major = i % 6 === 0;
    const r0 = major ? R * 0.80 : R * 0.88;
    ctx.strokeStyle = major ? ink : faint;
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang) * R * 0.95, cy + Math.sin(ang) * R * 0.95);
    ctx.stroke();
  }
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(size / 22)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let hIdx = 0; hIdx < 12; hIdx++) {
    const ang = (hIdx / 12) * Math.PI * 2 - Math.PI / 2;
    const label = hIdx === 0 ? '12' : String(hIdx);
    ctx.fillText(label, cx + Math.cos(ang) * R * 0.70, cy + Math.sin(ang) * R * 0.70);
  }

  // where Polaris goes
  const ang = (dialDecimal / 12) * Math.PI * 2 - Math.PI / 2;
  const rr = ringR(Math.max(innerMin, Math.min(outerMin, radiusArcmin)));
  const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;

  ctx.strokeStyle = night ? '#ffb0a0' : '#7CFFB2';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy); ctx.lineTo(px, py);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = night ? '#ffb0a0' : '#7CFFB2';
  ctx.beginPath();
  ctx.arc(px, py, Math.max(5, size / 40), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, Math.max(11, size / 19), 0, Math.PI * 2);
  ctx.strokeStyle = night ? '#ffb0a0' : '#7CFFB2';
  ctx.lineWidth = 2;
  ctx.stroke();

  // pole at the centre
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}
