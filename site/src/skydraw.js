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

  // Paths. Drawn after the constellation figures and before the stars, so a
  // track passes over the joining lines and under the things it is a track OF.
  if (o.tracks) for (const t of o.tracks) drawTrack(ctx, t, basis, focal, cx, cy, w, h, night);

  // Planets. ALWAYS NAMED: "which of those dots is Jupiter" is the entire
  // question, and an unlabelled planet is just a star that happens to be in
  // the wrong catalogue. Drawn a little larger than a star of the same
  // magnitude, which is also how they look -- a steady disc rather than a
  // twinkling point.
  if (o.planets) {
    for (const p of o.planets) {
      if (p.alt <= 0) continue;                 // under your feet, not off-screen
      const q = projectToScreen(p.v, basis, focal);
      if (!q) continue;
      const x = cx + q.x, y = cy + q.y;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
      const r = Math.max(2.2, starRadius(p.magnitude) * 1.4);
      ctx.fillStyle = night ? '#ff0000' : p.colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = night ? '#cc0000' : '#cfd8ea';
      ctx.font = `600 ${Math.round(h / 32)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(p.name, x + r + 5, y);
      ctx.textAlign = 'center';
    }
  }

  // The Moon, with the phase it actually has and the lit side facing the Sun.
  //
  // DRAWN LARGER THAN LIFE, DELIBERATELY. The real Moon is about half a degree
  // across, which at a 65-degree field is six pixels -- too small to read a
  // phase from at all. It gets a floor of h/20 instead, the way a chart
  // exaggerates a symbol it needs you to recognise. Its POSITION is exact; its
  // size is not, and the caption says so rather than leaving it to be noticed.
  if (o.moon && o.moon.alt > -1) {
    const q = projectToScreen(o.moon.v, basis, focal);
    if (q) {
      const x = cx + q.x, y = cy + q.y;
      const trueR = Math.tan(0.26 * Math.PI / 180) * focal;
      const r = Math.max(h / 20, trueR);

      // North and east as they run on screen at this point, measured from the
      // projection rather than assumed. The bright limb is at position angle
      // PA from north through east, which in this frame is exactly
      // cos(PA) * north + sin(PA) * east.
      const pn = projectToScreen(o.moon.vNorth, basis, focal);
      const pe = projectToScreen(o.moon.vEast, basis, focal);
      let angle = 0;
      if (pn && pe) {
        const norm = (dx, dy) => {
          const m = Math.hypot(dx, dy) || 1;
          return [dx / m, dy / m];
        };
        const [nx, ny] = norm(pn.x - q.x, pn.y - q.y);
        const [ex, ey] = norm(pe.x - q.x, pe.y - q.y);
        const pa = (o.moon.brightLimb || 0) * Math.PI / 180;
        angle = Math.atan2(
          ny * Math.cos(pa) + ey * Math.sin(pa),
          nx * Math.cos(pa) + ex * Math.sin(pa),
        );
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      moonFace(ctx, r, o.moon.illuminated, night);
      ctx.restore();

      ctx.fillStyle = night ? '#cc0000' : '#cfd8ea';
      ctx.font = `600 ${Math.round(h / 32)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('Moon', x + r + 5, y);
      ctx.textAlign = 'center';
    }
  }

  // The target: the pole itself, ringed, because that is what you align to.
  //
  // THE RING IS LOCKED TO THE SCREEN: h/14 px at every zoom.
  //
  // THIS HAS BEEN FLIPPED TWICE, SO THE REASONING IS WRITTEN DOWN. It was
  // briefly an angular size (a fixed 3.5 degrees of sky, projected through the
  // focal length) on the reading that "it should not scale up when zooming
  // out" meant it should hold its size AGAINST THE STARS. It does not. The
  // ring is a reticle, not a measurement: it says "your target is here", and a
  // marker that changes size while you zoom is a marker you have to re-read
  // every time. Screen-locked is the decision.
  //
  // The known cost, which is real and was the reason for the angular attempt:
  // at the widest field the sky shrinks under a ring that does not, so the
  // ring covers more constellations than it did. That is accepted. If it ever
  // needs softening, clamp it -- do not make it angular again.
  const tp = projectToScreen(altAzToVector(targetAlt, targetAz), basis, focal);
  let onScreen = false;
  if (tp) {
    const x = cx + tp.x, y = cy + tp.y;
    onScreen = x > 0 && x < w && y > 0 && y < h;
    const r = h / 14;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Crosshair ticks just outside the ring, so they scale with it.
    ctx.beginPath();
    ctx.moveTo(x - r * 1.7, y); ctx.lineTo(x - r * 1.15, y);
    ctx.moveTo(x + r * 1.15, y); ctx.lineTo(x + r * 1.7, y);
    ctx.stroke();
    // The label stays a fixed, readable size and sits just above the ring
    // rather than at a fixed offset -- otherwise it lands inside a large ring
    // when zoomed in and far above a small one when zoomed out.
    const fontPx = Math.round(h / 24);
    ctx.fillStyle = accent;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(targetName, x, y - r - fontPx * 0.4);
    ctx.textBaseline = 'middle';
  }

  // The ISS, if it has been asked for and is above the horizon.
  if (o.iss) {
    const ip = projectToScreen(altAzToVector(o.iss.alt, o.iss.az), basis, focal);
    if (ip) {
      const x = cx + ip.x, y = cy + ip.y;
      // Hollow when eclipsed, filled when sunlit: up-but-invisible and
      // up-and-shining are completely different answers to "can I see it".
      const col = night ? '#ff0000' : (o.iss.sunlit ? '#ffe26a' : '#6b7793');
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, h / 46, 0, Math.PI * 2);
      if (o.iss.sunlit) ctx.fill(); else ctx.stroke();
      ctx.font = `600 ${Math.round(h / 30)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(o.iss.sunlit ? 'ISS' : 'ISS (in shadow)', x + h / 34, y);
      ctx.textAlign = 'center';
    }
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

/**
 * The Moon as a disc, lit from the correct side.
 *
 * The terminator is an ellipse, not a straight edge: you are looking at a
 * sphere, so the boundary between lit and unlit is a circle seen at an angle.
 * Drawing it straight gives a shape nobody has ever seen in the sky.
 */
/**
 * The lit face, centred on the origin, with the bright limb toward +x.
 *
 * ONE implementation of the phase shape, shared by the card and by the Moon
 * drawn into the sky view. Whoever calls it decides which way the light is
 * coming from by rotating the canvas first -- which is exactly what the
 * difference between the two is.
 */
function moonFace(ctx, r, illuminated, night) {
  ctx.fillStyle = night ? '#2a0000' : '#23283a';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // k is how far the terminator has swept across the face, 0..1.
  const k = Math.max(0, Math.min(1, illuminated));
  if (k > 0.001) {
    ctx.fillStyle = night ? '#ff3a2a' : '#e8e4d8';
    ctx.beginPath();
    // Half the disc is always a plain semicircle; the other half is the
    // terminator ellipse, which bulges one way before half phase and the other
    // way after. A straight edge is a shape nobody has ever seen in the sky.
    const start = -Math.PI / 2;
    ctx.arc(0, 0, r, start, start + Math.PI, false);
    const bulge = r * (2 * k - 1);
    ctx.ellipse(0, 0, Math.abs(bulge), r, 0, start + Math.PI, start, bulge < 0);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = night ? '#7a0000' : '#3a4356';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * One body's path across the sky, dashed, and named along its length.
 *
 * WHY THE NAME REPEATS. Every planet path runs close to the ecliptic, so half
 * a dozen of them share one stripe of sky. A single label at one end leaves
 * you tracing a line with your finger to find out which planet it belongs to;
 * a name every so often answers that wherever you happen to be looking.
 *
 * THE LINE BREAKS AT THE HORIZON AND BEHIND YOU. A path that runs under the
 * ground is drawn faint rather than dropped -- "it comes up over there in
 * twenty minutes" is the useful half of a station's orbit -- but the segment
 * that would join the last visible point to one behind your head is not drawn
 * at all, because projectToScreen refuses anything behind the viewer and
 * joining across that gap draws a line through the middle of the picture.
 */
export function drawTrack(ctx, track, basis, focal, cx, cy, w, h, night) {
  const { points, colour, label, labelEvery = 14, width = 1.6, dash = [7, 6] } = track;
  if (!points || points.length < 2) return;

  const ink = night ? (track.nightColour || '#8b0000') : colour;
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineWidth = Math.max(1, width * (w / 720));
  ctx.strokeStyle = ink;

  let prev = null, prevUp = true;
  const seen = [];
  for (const p of points) {
    const q = projectToScreen(p.v, basis, focal);
    if (!q) { prev = null; continue; }
    const x = cx + q.x, y = cy + q.y;
    if (prev) {
      // Below the horizon it stays drawn, but faintly: it is where the thing
      // is going to come up from, not where it can be seen.
      ctx.globalAlpha = (p.up && prevUp) ? 0.85 : 0.3;
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev = [x, y]; prevUp = p.up;
    if (p.up && x > 0 && x < w && y > 0 && y < h) seen.push([x, y]);
  }

  if (label && seen.length) {
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = ink;
    ctx.font = `600 ${Math.round(h / 38)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // AT LEAST ONE NAME, ALWAYS. The first label sits half an interval in so
    // repeated names land evenly along a long path -- but a track that only
    // clips the corner of the view can have fewer on-screen points than that
    // offset, and the loop then ran zero times and left an anonymous dashed
    // line, which is the one thing a track must never be.
    const first = Math.min(Math.floor(labelEvery / 2), seen.length - 1);
    for (let i = first; i < seen.length; i += labelEvery) {
      ctx.fillText(label, seen[i][0], seen[i][1] - 4);
    }
    ctx.textBaseline = 'middle';
  }
  ctx.restore();
}

export function drawMoonDisc(ctx, { illuminated, waxing, size, night = false }) {
  const r = size / 2 - 3;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  // Waxing lights the right-hand limb from the northern hemisphere, which is
  // the convention every almanac prints. Waning is the same face turned round.
  if (!waxing) ctx.rotate(Math.PI);
  moonFace(ctx, r, illuminated, night);
  ctx.restore();
}
