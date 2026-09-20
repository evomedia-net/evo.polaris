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
    hemisphere: 'north',
    lines: [[5191, 5054], [5054, 4905], [4905, 4660], [4660, 4554],
            [4554, 4295], [4295, 4301], [4301, 4660]],
  },
  cassiopeia: {
    name: 'Cassiopeia (the W)',
    hemisphere: 'north',
    lines: [[21, 168], [168, 264], [264, 403], [403, 542]],
  },
  littleDipper: {
    name: 'The Little Dipper',
    hemisphere: 'north',
    lines: [[424, 5563], [5563, 5735]],
  },
  // Crux: Gacrux at the top, Acrux at the foot, Mimosa and Delta across.
  crux: {
    name: 'The Southern Cross',
    hemisphere: 'south',
    lines: [[4763, 4730], [4853, 4656]],
  },
  // The Pointers. Drawn as a pair so the eye picks them out next to Crux;
  // they are how you tell the real Cross from the False Cross.
  pointers: {
    name: 'The Pointers (Alpha and Beta Centauri)',
    hemisphere: 'south',
    lines: [[5459, 5267]],
  },
};

export const POLARIS_HR = 424;
export const SIGMA_OCT_HR = 7228;       // magnitude 5.47 -- faint, see below

const MERAK = 4295;        // beta UMa -- the back of the Dipper's bowl
const DUBHE = 4301;        // alpha UMa -- the lip; Merak->Dubhe points at Polaris
// alpha1 Cru, the foot of the Cross. The long axis Gacrux -> Acrux, extended
// about 4.5 times its own length, lands on the south celestial pole. The
// asterism line above already draws that axis, so only the foot is needed here
// -- the arrow continues from it.
const ACRUX = 4730;
const ALPHA_CEN = 5459;    // the Pointers: Alpha and Beta Centauri. Their
const BETA_CEN = 5267;     // perpendicular bisector crosses the Cross's axis
                           // at the pole, and confirms it is the real Cross.

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
 * @param {boolean} opts.showPointer  draw the star-hop arrow
 * @param {boolean} opts.south     chart the south celestial pole instead
 */
export function drawSkyChart(ctx, opts) {
  const { stars, lst, radiusDeg = 50, night = false,
          size, showPointer = true, south = false } = opts;
  // Sigma Octantis is magnitude 5.47, so a 5.2 cut-off would filter the south
  // pole star out of its own chart. The southern sky needs the fainter limit
  // for that one star; the northern chart does not and stays cleaner without.
  const limitMag = opts.limitMag ?? (south ? 5.6 : 5.2);
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
    const p = projectAroundPole(s[0], s[1], lst, radiusDeg, south);
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
  ctx.strokeStyle = night ? '#8b0000' : '#5b7fb8';
  const want = south ? 'south' : 'north';
  for (const a of Object.values(ASTERISMS)) {
    if (a.hemisphere !== want) continue;
    for (const [p, q] of a.lines) {
      const pa = byHr.get(p), pb = byHr.get(q);
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  const amber = night ? '#cc0000' : '#ffb454';
  const target = night ? '#ff0000' : '#7CFFB2';

  // The star-hop. In the north it ends on a bright star you can actually see.
  // In the south it does NOT: there is no southern Polaris, so the line runs
  // from the foot of the Cross to the pole ITSELF, which is empty sky.
  const pole = { x: cx, y: cy };
  const from = byHr.get(south ? ACRUX : DUBHE);
  const polaris = byHr.get(POLARIS_HR);
  const to = south ? pole : polaris;
  if (showPointer && from && to) {
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = Math.max(2, size / 240);
    ctx.strokeStyle = amber;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    arrowHead(ctx, from, to, amber, size / 46);
  }

  // The Pointers' perpendicular bisector -- the SECOND southern method, and
  // the one that confirms the first. Take the midpoint of Alpha-Beta Centauri
  // and strike off at right angles; where it crosses the Cross's long axis is
  // the pole. Two independent lines meeting on the same empty patch of sky is
  // far more convincing than one line into nothing, which is all the Cross
  // gives you on its own.
  if (showPointer && south) {
    const a = byHr.get(ALPHA_CEN), b = byHr.get(BETA_CEN);
    if (a && b) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Unit normal to the Pointers, aimed at the pole rather than away.
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      if ((pole.x - mid.x) * nx + (pole.y - mid.y) * ny < 0) { nx = -nx; ny = -ny; }
      const reach = Math.hypot(pole.x - mid.x, pole.y - mid.y);
      ctx.save();
      ctx.setLineDash([3, 7]);
      ctx.lineWidth = Math.max(1.5, size / 300);
      ctx.strokeStyle = amber;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(mid.x + nx * reach, mid.y + ny * reach);
      ctx.stroke();
      ctx.restore();
    }
  }

  // The target, drawn last so it sits on top.
  const mark = (pt, label) => {
    ctx.strokeStyle = target;
    ctx.lineWidth = Math.max(2, size / 220);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, size / 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = target;
    ctx.font = `600 ${Math.round(size / 24)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, pt.x + size / 22, pt.y + size / 72);
  };

  if (south) {
    // The pole is the target; Sigma Octantis is only a landmark, and a faint
    // one, so it is labelled separately rather than ringed as the thing to aim
    // at. Ringing a magnitude 5.47 star as "the target" would be misleading.
    mark(pole, 'South pole');
    const sig = byHr.get(SIGMA_OCT_HR);
    if (sig) {
      ctx.fillStyle = night ? '#990000' : '#9aa6bd';
      ctx.font = `500 ${Math.round(size / 30)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('σ Oct (mag 5.5)', sig.x + size / 40, sig.y + size / 60);
    }
  } else if (polaris) {
    mark(polaris, 'Polaris');
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
export function drawReticle(ctx, {
  dialDecimal, radiusArcmin, size, night = false, rings = [36, 44],
}) {
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 10;
  // The engraved circles differ by hemisphere -- 36'-44' for Polaris, 60'-70'
  // for Sigma Octantis -- so the drawn scale has to follow the reticle the
  // observer is actually looking through, not a fixed range.
  const [ringLo, ringHi] = rings;
  const innerMin = ringLo - 2, outerMin = ringHi + 2;
  const ink = night ? '#ff0000' : '#dfe6f2';
  const faint = night ? '#7a0000' : '#46506a';

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

  // the graduation circles for this hemisphere's pole star
  for (let m = ringLo; m <= ringHi; m += 2) {
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
