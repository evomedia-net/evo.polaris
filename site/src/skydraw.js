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

// HOW FAR DOWN A BODY CAN BE AND STILL BE PAINTED.
//
// Exported because the app has to say the same thing in words that this file
// says in pixels. Reported as "moon is gone": the Moon was 57 degrees under
// the ground, so it was correctly not drawn -- but the app still let you
// target it, travelled the view to it, ringed it and captioned it "Moon",
// with nothing inside the ring and not a word about why. A ring around
// nothing is the app looking broken while it is in fact being accurate.
//
// The Moon gets a degree of slack because refraction genuinely lifts it into
// view when it is geometrically just below; a planet is a point of light and
// gets none.
export const MOON_MIN_ALT = -1;
export const PLANET_MIN_ALT = 0;

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
          targetName, reticleR, w, h, fov = 65, night = false } = o;

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
  // THE SHORT SIDE IS THE RULER FOR EVERYTHING DRAWN AT A FIXED SCREEN SIZE.
  //
  // These were all keyed to h, which is the same thing right up until the
  // canvas stops being wider than it is tall. Full screen in PORTRAIT it is
  // the long side, and every marker and label silently inflated with it: the
  // target ring went from 14% of the narrow side of the view to 31% of it --
  // reported simply as "the green ring is really big in full screen mode".
  //
  // Measured on a 390x844 phone at dpr 2: ring diameter 121px in portrait
  // full screen against 56px everywhere else. Worse, the app fills the screen
  // BY ITSELF when you turn the phone, so the ring changed size as you
  // rotated -- the one thing a reticle must never do.
  //
  // min(w, h) is h for the windowed 3:2 canvas and h again in landscape, so
  // nothing outside portrait full screen moves by a pixel.
  const ref = Math.min(w, h);
  // What the ring is on, by name alone. The caption may carry more than the
  // name ("Pluto — has set") while a body and its path are just "Pluto".
  const ringName = targetName ? String(targetName).split(' — ')[0] : null;
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
  ctx.font = `600 ${Math.round(ref / 26)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [az, label] of CARDINALS) {
    const p = projectToScreen(altAzToVector(0, az), basis, focal);
    if (!p) continue;
    const x = cx + p.x, y = cy + p.y;
    if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
    ctx.fillStyle = label.length === 1 ? ink : dim;
    ctx.fillText(label, x, y + ref / 34);
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
      ctx.font = `500 ${Math.round(ref / 34)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(NAMED.get(s.hr), x + r + 5, y);
      ctx.textAlign = 'center';
    }
  }

  // Paths. Drawn after the constellation figures and before the stars, so a
  // track passes over the joining lines and under the things it is a track OF.
  // One list of where names have already been put, shared by every track in
  // the frame: two different paths crossing the same patch of sky were happy
  // to write "Uranus" straight over "Mars".
  //
  // A BODY'S OWN NAME IS RESERVED BEFORE ITS PATH IS DRAWN.
  //
  // Every planet sits ON its own path, so the dot's label and the path's
  // label landed side by side and the name appeared twice -- "Neptune" in
  // yellow next to "Neptune" in white, for every planet at once. The bodies
  // are drawn after the tracks, so the only way the tracks can know is to
  // work out where those labels will go first and claim the space. The body
  // wins the argument: the dot is the thing, the path is the context.
  // ...AND THAT FIX TURNED AN OVERLAP INTO A DUPLICATE. Claiming the space
  // stops the two labels landing on top of each other by moving one of them
  // somewhere else -- so instead of "Pluto" over "Pluto" you get "Pluto"
  // here and "Pluto" a hundred pixels away, which was reported as "still
  // lots of dupe names". Three things name the same object and none of them
  // knew the others existed: the path, the body, and the ring.
  //
  // So the pre-pass now also says which names are ALREADY SPOKEN FOR, and
  // there is an order of precedence: the ring names its target, a body on
  // screen names itself, and a path names its body only when nothing else
  // will. That last case is the whole reason track labels exist -- "which
  // dashed line is this?" -- and it is the only one left that has to answer.
  const placed = [];
  const spoken = new Set();
  reserveBodyLabels(ctx, o, basis, focal, cx, cy, w, h, ref, placed, spoken);
  if (o.tracks) {
    for (const t of o.tracks) {
      drawTrack(ctx, t, basis, focal, cx, cy, w, h, night, placed, spoken);
    }
  }

  // Planets. ALWAYS NAMED: "which of those dots is Jupiter" is the entire
  // question, and an unlabelled planet is just a star that happens to be in
  // the wrong catalogue. Drawn a little larger than a star of the same
  // magnitude, which is also how they look -- a steady disc rather than a
  // twinkling point.
  if (o.planets) {
    for (const p of o.planets) {
      if (p.alt <= PLANET_MIN_ALT) continue;    // under your feet, not off-screen
      const q = projectToScreen(p.v, basis, focal);
      if (!q) continue;
      const x = cx + q.x, y = cy + q.y;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
      const r = Math.max(2.2, starRadius(p.magnitude) * 1.4);
      ctx.fillStyle = night ? '#ff0000' : p.colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // ONE NAME PER OBJECT. If the ring is on this planet it is already
      // captioned, in bigger type, right where you are looking.
      if (p.name !== ringName) {
        ctx.fillStyle = night ? '#cc0000' : '#cfd8ea';
        ctx.font = `600 ${Math.round(ref / 32)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(p.name, x + r + 5, y);
        ctx.textAlign = 'center';
      }
    }
  }

  // The Moon, with the phase it actually has and the lit side facing the Sun.
  //
  // DRAWN LARGER THAN LIFE, DELIBERATELY. The real Moon is about half a degree
  // across, which at a 65-degree field is six pixels -- too small to read a
  // phase from at all. It gets a floor of h/20 instead, the way a chart
  // exaggerates a symbol it needs you to recognise. Its POSITION is exact; its
  // size is not, and the caption says so rather than leaving it to be noticed.
  if (o.moon && o.moon.alt > MOON_MIN_ALT) {
    const q = projectToScreen(o.moon.v, basis, focal);
    if (q) {
      const x = cx + q.x, y = cy + q.y;
      const trueR = Math.tan(0.26 * Math.PI / 180) * focal;
      const r = Math.max(ref / 20, trueR);

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

      if (ringName !== 'Moon') {
        ctx.fillStyle = night ? '#cc0000' : '#cfd8ea';
        ctx.font = `600 ${Math.round(ref / 32)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('Moon', x + r + 5, y);
        ctx.textAlign = 'center';
      }
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
  // NO TARGET AT ALL IS A STATE. Cycling past the last planet clears it, so
  // the ring and the pointer both have to be able to simply not be there --
  // and "nothing is off screen" is the honest answer for the pointer, not
  // "everything is", which would leave an arrow aimed at nothing in
  // particular.
  const hasTarget = targetName != null && targetName !== '';
  const tp = hasTarget
    ? projectToScreen(altAzToVector(targetAlt, targetAz), basis, focal) : null;
  let onScreen = !hasTarget;
  if (tp) {
    const x = cx + tp.x, y = cy + tp.y;
    onScreen = x > 0 && x < w && y > 0 && y < h;
    // FROM THE VIEWPORT, NOT FROM THIS CANVAS. A reticle that changes size
    // when the same view is made bigger is one you have to re-read every time
    // it does; min(w, h) grew with the canvas, so full screen on a desktop
    // drew it at 1.6x the windowed size. The caller measures the window,
    // which full screen does not change. Falls back to the old rule only if
    // nobody said -- and a test holds the app to passing it.
    const r = reticleR || ref / 14;
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
    const fontPx = Math.round(ref / 24);
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
      ctx.arc(x, y, ref / 46, 0, Math.PI * 2);
      if (o.iss.sunlit) ctx.fill(); else ctx.stroke();
      ctx.font = `600 ${Math.round(ref / 30)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(o.iss.sunlit ? 'ISS' : 'ISS (in shadow)', x + ref / 34, y);
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
    // AN ARROWHEAD, AND ONE BIG ENOUGH TO READ.
    //
    // It was a flat triangle 24 device pixels long, and -- alone among
    // everything drawn here -- it was never scaled, so on a phone at dpr 2 it
    // came out about 12 CSS pixels: a speck, and a shape that could as easily
    // have been a star as a pointer. It is the only thing on screen saying
    // which way to turn when the target is off the edge, so it has to be
    // found at a glance.
    //
    // Swept back to a notch rather than cut straight across. A plain triangle
    // reads as a wedge pointing either way; the concave tail is what makes an
    // arrow an arrow.
    const L = Math.max(22, ref / 12);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(L * 0.52, 0);                 // tip
    ctx.lineTo(-L * 0.48, L * 0.44);         // back corner
    ctx.lineTo(-L * 0.22, 0);                // the notch
    ctx.lineTo(-L * 0.48, -L * 0.44);        // other back corner
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
/**
 * Claim the space each body's own name will take, before any path is drawn.
 *
 * Positions have to match what the drawing code below does exactly -- same
 * visibility rules, same font, same offset -- or the reservation is for the
 * wrong patch of screen and the duplicate comes back. Entries are stored as
 * CENTRES because that is what the track labels are measured from.
 */
function reserveBodyLabels(ctx, o, basis, focal, cx, cy, w, h, ref, placed,
                           spoken = new Set()) {
  // FROM ANY VIEW OF A LINE YOU MUST BE ABLE TO TELL WHAT IT IS. So a name
  // only counts as spoken where it is actually VISIBLE: a body or a ring
  // somewhere off the edge silences nothing, because a reader looking at this
  // frame cannot see it. Same margin the bodies are drawn with, so what is
  // reserved and what is painted cannot disagree.
  const onCanvas = (x, y) => x > -40 && x < w + 40 && y > -40 && y < h + 40;
  const claim = (text, left, y, fontPx) => {
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    const half = ctx.measureText(text).width / 2;
    placed.push({ x: left + half, y, half });
    if (onCanvas(left + half, y)) spoken.add(text);
  };
  // THE RING SPEAKS FIRST, because it wins: it is the thing you asked for.
  // Its label was never claimed in `placed` at all, so a path could be
  // labelled straight through it -- the "Pluto" lying across the Moon in the
  // report. The base name, because the caption may carry more than the name
  // ("Pluto — has set") while the path is just "Pluto".
  const ringName = o.targetName ? String(o.targetName).split(' — ')[0] : null;
  if (ringName) {
    const tp = projectToScreen(altAzToVector(o.targetAlt, o.targetAz), basis, focal);
    if (tp) {
      const fontPx = Math.round(ref / 24);
      const r = o.reticleR || ref / 14;
      ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
      const half = ctx.measureText(o.targetName).width / 2;
      const x = cx + tp.x, y = cy + tp.y - r - fontPx * 0.4;
      placed.push({ x, y, half });
      // Only when it can be SEEN. Off the edge there is no ring and no
      // caption, only the arrow -- and a target off the edge silencing its
      // own orbit line would leave an anonymous dashed line with nothing on
      // screen to explain it.
      if (onCanvas(x, y)) spoken.add(ringName);
    }
  }
  if (o.planets) {
    for (const p of o.planets) {
      if (p.alt <= PLANET_MIN_ALT) continue;
      const q = projectToScreen(p.v, basis, focal);
      if (!q) continue;
      const x = cx + q.x, y = cy + q.y;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
      const r = Math.max(2.2, starRadius(p.magnitude) * 1.4);
      // Nothing to claim if the ring is already naming it: the body's own
      // label is not drawn, and reserving space for a word nobody paints is
      // how the Moon's label came to shove its neighbours aside while
      // invisible.
      if (p.name !== ringName) claim(p.name, x + r + 5, y, Math.round(ref / 32));
    }
  }
  // THE SAME GATE THE MOON IS DRAWN BY. This had none, so with the Moon under
  // the ground the layout still shoved other labels aside to keep room for a
  // word that was never painted.
  if (o.moon && o.moon.alt > MOON_MIN_ALT) {
    const q = projectToScreen(o.moon.v, basis, focal);
    if (q) {
      const x = cx + q.x, y = cy + q.y;
      // The planets check their bounds before claiming and the Moon did not,
      // so a Moon somewhere off the edge counted as naming its own path.
      const r = Math.max(ref / 20, 8);
      if (ringName !== 'Moon') claim('Moon', x + r + 5, y, Math.round(ref / 32));
    }
  }
  if (o.iss) {
    const q = projectToScreen(altAzToVector(o.iss.alt, o.iss.az), basis, focal);
    if (q) {
      claim(o.iss.sunlit ? 'ISS' : 'ISS (in shadow)',
        cx + q.x + ref / 34, cy + q.y, Math.round(ref / 30));
    }
  }
}

export function drawTrack(ctx, track, basis, focal, cx, cy, w, h, night,
                          placed = [], spoken = new Set()) {
  const { points, colour, label, width = 1.6, dash = [7, 6] } = track;
  if (!points || points.length < 2) return;

  const ink = night ? (track.nightColour || '#8b0000') : colour;
  ctx.save();
  // THE DASH SCALES WITH THE CANVAS, LIKE THE LINE IT IS MADE OF.
  //
  // The width was scaled here and the dash was not, so on a phone -- where the
  // backing store is two or three times 720 wide -- the stroke got thicker
  // while each dash stayed the same few pixels long. The ratio collapsed and
  // the dashes stopped reading as a broken line and started reading as a row
  // of blocks. Scaling both keeps a dash a dash at every size.
  const scale = w / 720;
  ctx.setLineDash(dash.map((d) => d * scale));
  ctx.lineWidth = Math.max(1, width * scale);
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

  // A PATH NAMES ITS BODY ONLY WHEN NOTHING ELSE WILL. The ring names its
  // target and a body on screen names itself; a third copy along the dashes
  // is what "still lots of dupe names" was about. The label still happens
  // whenever the body is NOT on screen -- set, or off the edge -- which is
  // the question track labels exist to answer: which dashed line is this?
  if (label && seen.length && !spoken.has(label)) {
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = ink;
    const fontPx = Math.round(Math.min(w, h) / 38);
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // NAMES ARE SPACED BY DISTANCE ON SCREEN, NOT BY HOW MANY SAMPLES WENT BY.
    //
    // They used to be drawn every Nth on-screen point, which assumes the
    // samples are spread evenly across the picture. They are not. A planet is
    // sampled every three days over six months, and at a retrograde
    // stationary point it barely moves for weeks -- so a dozen samples land
    // within a few pixels and every one of them that hit the interval wrote
    // the name in the same place. The report was "Uranus" over "Uranus" over
    // "Uranus" over "Mars".
    //
    // `placed` is shared by every track in the frame, so the cross-path half
    // of that -- two different names in one spot -- is covered by the same
    // rule as the repeats.
    const half = ctx.measureText(label).width / 2;
    const fits = (x, y) => !placed.some((r) => (
      Math.abs(r.x - x) < (r.half + half + fontPx) && Math.abs(r.y - y) < fontPx * 1.4
    ));
    // HOW OFTEN A PATH REPEATS ITS NAME. It went every Nth sample, which put
    // "Moon" five times down one screen; then spaced by distance; then, for
    // one commit, once. That last was an over-correction and is recorded here
    // so nobody repeats it:
    //
    //   "there should be names every now and then along each dashed line for
    //    reference when looking around, just not piled on in small area"
    //
    // A long dashed line running off both edges of the view needs to say what
    // it is wherever you have panned to -- one label is one place, and
    // anywhere else on the path the line is anonymous again. The duplicates
    // that were actually reported were three DIFFERENT things naming one
    // object within a few centimetres (the ring, the body and the path), not
    // a path naming itself at opposite corners. Precedence fixed that; this
    // spacing is what stops the remaining names bunching.
    //
    // The diagonal is the longest run a path can make across the view, so the
    // spacing comes from it rather than from the height, which says nothing
    // about a path crossing the picture corner to corner.
    const gap = Math.max(fontPx * 6, Math.hypot(w, h) / 3);
    let drew = 0;
    let lastX = -1e9, lastY = -1e9;
    for (const [x, y] of seen) {
      if (Math.hypot(x - lastX, y - lastY) < gap) continue;
      if (!fits(x, y - 4)) continue;
      ctx.fillText(label, x, y - 4);
      placed.push({ x, y: y - 4, half });
      lastX = x; lastY = y;
      drew += 1;
    }
    // AT LEAST ONE NAME, ALWAYS -- even when every spot along it was taken.
    // An unnamed dashed line is the one thing a track must never be.
    //
    // Two planets really can sit in the same few pixels; at a stationary point
    // they sit there for weeks. There is then nowhere along either path to put
    // a name that is clear of the other, so the name is lifted instead, and
    // they stack. Stacked reads; overlaid does not.
    if (drew === 0) {
      const [x, y0] = seen[Math.floor(seen.length / 2)];
      let y = y0 - 4;
      for (let k = 0; k < 8 && !fits(x, y); k++) y -= fontPx * 1.5;
      ctx.fillText(label, x, y);
      placed.push({ x, y, half });
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
