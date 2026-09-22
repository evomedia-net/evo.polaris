// A live window on the sky: hold the phone up and see the stars where they
// actually are, the way Stellarium and its kin work.
//
// This is a gnomonic (rectilinear) projection -- the same one a camera lens
// performs -- of the sky onto the screen, centred on wherever the phone is
// aimed. Straight lines in the sky stay straight, and the scale is set by a
// field of view rather than by squeezing the whole hemisphere into a disc the
// way the circumpolar chart does.
//
// IT IS AN ADDITION, NOT A REPLACEMENT. Everything it shows also exists as
// numbers and as the arrows, because it asks for something the rest of this
// app deliberately never asks for: holding a phone up, steadily, and looking
// at it. Some people cannot do that at all. The chart, the reticle and the
// spoken briefing stay exactly as they were.
//
// WHY A FULL ROTATION MATRIX RATHER THAN THREE ANGLES. It is tempting to take
// heading for left/right and beta for up/down and be done, which is what the
// arrows do. That works for "which way do I turn" and falls apart here: tip
// the phone sideways and the sky must roll with it, and near the zenith the
// naive version gimbals and the view snaps around. Building the device's
// actual basis and projecting onto it costs a dozen lines and has neither
// problem.

import { precessEquatorial } from './astro.js';

const DEG = Math.PI / 180;

/**
 * The device's orientation as three world-frame axes.
 *
 * The world frame here is the one DeviceOrientation uses: X east, Y north,
 * Z up. The device frame is X right, Y top, Z out of the screen toward you --
 * so the direction the BACK of the phone is aimed at, the one you point at
 * things, is minus Z.
 *
 * @param {number} alphaDeg  compass rotation
 * @param {number} betaDeg   front-back tilt
 * @param {number} gammaDeg  left-right roll
 * @param {number} declDeg   magnetic declination, east positive
 * @returns {{right:number[], up:number[], forward:number[]}} unit vectors [E,N,U]
 */
export function deviceBasis(alphaDeg, betaDeg, gammaDeg, declDeg = 0) {
  const a = (alphaDeg || 0) * DEG;
  const b = (betaDeg || 0) * DEG;
  const g = (gammaDeg || 0) * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);

  // W3C's ZXY composition, R = Rz(alpha) Rx(beta) Ry(gamma), written out as
  // columns because the columns are exactly the axes we want.
  const right = [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG];
  const up = [-cB * sA, cA * cB, sB];
  const toward = [cA * sG + cG * sA * sB, sA * sG - cA * cG * sB, cB * cG];
  const forward = [-toward[0], -toward[1], -toward[2]];

  // The device reports against MAGNETIC north on most hardware, and the sky is
  // catalogued against true north. Rotating the basis about the up axis is the
  // whole correction; azimuth increases eastward, so a positive declination
  // turns each vector that way.
  if (!declDeg) return { right, up, forward };
  const d = declDeg * DEG, cD = Math.cos(d), sD = Math.sin(d);
  const spin = (v) => [v[0] * cD + v[1] * sD, -v[0] * sD + v[1] * cD, v[2]];
  return { right: spin(right), up: spin(up), forward: spin(forward) };
}

/** A horizontal coordinate as a unit vector in [east, north, up]. */
export function altAzToVector(altDeg, azDeg) {
  const alt = altDeg * DEG, az = azDeg * DEG;
  const c = Math.cos(alt);
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)];
}

/** The altitude and azimuth a unit vector points at. */
export function vectorToAltAz(v) {
  return {
    alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
    az: ((Math.atan2(v[0], v[1]) / DEG) % 360 + 360) % 360,
  };
}

/** Focal length in pixels for a horizontal field of view across `width`. */
export function focalLength(width, fovDeg) {
  return (width / 2) / Math.tan((fovDeg / 2) * DEG);
}

/**
 * Project a direction onto the screen.
 *
 * Returns null when the direction is behind the phone. That test is not
 * optional decoration: without it every star behind you is mirrored through
 * the origin and drawn in front, which produces a plausible-looking sky that
 * is upside down and back to front.
 *
 * @returns {{x:number, y:number, depth:number}|null} pixels from the centre
 */
export function projectToScreen(vec, basis, focal) {
  const { right, up, forward } = basis;
  const depth = vec[0] * forward[0] + vec[1] * forward[1] + vec[2] * forward[2];
  if (depth <= 1e-6) return null;
  const rx = vec[0] * right[0] + vec[1] * right[1] + vec[2] * right[2];
  const ry = vec[0] * up[0] + vec[1] * up[1] + vec[2] * up[2];
  return { x: (rx / depth) * focal, y: -(ry / depth) * focal, depth };
}

/**
 * A point on the screen back to a direction in the sky: projectToScreen undone.
 *
 * Needed the moment the map can be touched. "Centre on what I tapped" and
 * "drag the sky under my finger" are both questions about which direction a
 * pixel stands for, and forward projection cannot answer them.
 *
 * Inverting the projection is exact rather than approximate: a screen offset
 * of (dx, dy) from the centre is the ray forward + (dx/focal)*right
 * - (dy/focal)*up, normalised. The minus is the same screen-y-points-down
 * convention projectToScreen applies on the way out.
 *
 * @param {number} dx pixels right of centre
 * @param {number} dy pixels BELOW centre (screen convention)
 */
export function screenToVector(dx, dy, basis, focal) {
  const { right, up, forward } = basis;
  const a = dx / focal, b = -dy / focal;
  const v = [
    forward[0] + a * right[0] + b * up[0],
    forward[1] + a * right[1] + b * up[1],
    forward[2] + a * right[2] + b * up[2],
  ];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Rotate `v` by the rotation that carries direction `from` onto direction `to`.
 *
 * This is what makes a drag feel like grabbing the sky rather than nudging it.
 * The ray under the finger when the drag started and the ray under it now are
 * both known; rotating the view by whatever turns the second back onto the
 * first keeps the grabbed patch of sky under the finger. Nudging by a fixed
 * number of degrees per pixel does not -- it drifts away from the hand, worst
 * near the pole and at wide fields, which is exactly where this map is used.
 *
 * Rodrigues' formula. Parallel inputs mean no rotation, which is the common
 * case on the first pixel of a drag and must not divide by zero.
 */
export function rotateFromTo(from, to, v) {
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const axis = cross(from, to);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  if (s < 1e-9) return [v[0], v[1], v[2]];
  const c = Math.max(-1, Math.min(1,
    from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const k = [axis[0] / s, axis[1] / s, axis[2] / s];
  const ang = Math.atan2(s, c);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const kv = cross(k, v);
  const kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * ca + kv[0] * sa + k[0] * kd * (1 - ca),
    v[1] * ca + kv[1] * sa + k[1] * kd * (1 - ca),
    v[2] * ca + kv[2] * sa + k[2] * kd * (1 - ca),
  ];
}

/**
 * Where to aim so that a grabbed patch of sky sits under a given pixel.
 *
 * A DRAG IS SOLVED, NOT APPROXIMATED, AND THE DIFFERENCE IS VISIBLE. Rotating
 * the view once by "whatever turns the ray now under the finger back onto the
 * ray grabbed at the start" is nearly right, but the aim is then re-expressed
 * as azimuth and altitude, which throws away the roll that rotation carried --
 * deliberately, because the horizon must stay level. Throwing it away moves
 * the answer, and the sky slid about fourteen pixels out from under the finger
 * on a long drag. Fourteen pixels is the sky visibly not sticking to the hand.
 *
 * So the rotation is re-solved against the basis it produced. Each pass asks
 * the same question from a better starting point, and for any drag anyone can
 * actually perform the leftover is gone within a few passes.
 *
 * IT KEEPS THE BEST ANSWER RATHER THAN THE LAST ONE, because the iteration is
 * not guaranteed to converge. At the widest fields a corner-to-corner drag
 * asks the view to swing more than a hundred degrees, and some of those
 * targets have no solution at all with the roll held at zero -- the horizon is
 * kept level, so not every patch of sky can be put at every pixel. Asked for
 * one of those, a plain loop wanders and gets WORSE the longer it runs: at a
 * 170 degree field it went from 65 degrees out after three passes to 129 after
 * six. Measuring each pass and stopping when it stops improving turns that
 * from a bug into a limit -- the view still moves the right way, it just does
 * not quite reach, which is what "as far as the horizon staying level allows"
 * has to look like.
 *
 * @param {number[]} grabbed the direction under the finger when the drag began
 * @param {number} px pixels right of centre, now
 * @param {number} py pixels below centre, now
 * @returns {{alt:number, az:number}} where the view should point
 */
export function aimAfterDrag(grabbed, px, py, basis, focal, passes = 6) {
  const missBy = (b) => {
    const showing = screenToVector(px, py, b, focal);
    return Math.acos(Math.max(-1, Math.min(1,
      showing[0] * grabbed[0] + showing[1] * grabbed[1] + showing[2] * grabbed[2])));
  };
  let b = basis;
  let best = vectorToAltAz(b.forward);
  let bestMiss = missBy(b);
  for (let i = 0; i < passes; i++) {
    const showing = screenToVector(px, py, b, focal);
    const aim = vectorToAltAz(rotateFromTo(showing, grabbed, b.forward));
    const next = basisFromAim(aim.az, aim.alt);
    const miss = missBy(next);
    if (!(miss < bestMiss)) break;      // no better: the last best stands
    bestMiss = miss; best = aim; b = next;
    if (miss < 1e-9) break;             // there is nothing left to fix
  }
  return best;
}

/** Apparent size of a star, in pixels, for a magnitude. */
export function starRadius(mag, limitMag = 5.5) {
  return Math.max(0.6, (limitMag + 0.9 - mag) * 0.62);
}

/** Star colour from B-V, matching the circumpolar chart. */
export function starColour(bv, night) {
  if (night) return '#cc0000';
  if (bv < -0.1) return '#a8c8ff';
  if (bv < 0.3) return '#ffffff';
  if (bv < 0.6) return '#fff6e0';
  if (bv < 1.0) return '#ffe0a8';
  if (bv < 1.5) return '#ffc080';
  return '#ff9e6e';
}

/**
 * Pre-compute every star's direction once per tick.
 *
 * The sky turns a quarter of a degree a minute; the phone moves far faster
 * than that. Recomputing hour angles for three thousand stars on every
 * orientation event would be most of the work for none of the benefit, so the
 * expensive half is done on a timer and only the projection runs per frame.
 */
/**
 * One object's direction in the observer's frame, from its equatorial place.
 *
 * ONE implementation, used by the stars, the planets and the Moon alike. Two
 * copies of this rotation would drift apart eventually, and the drift would
 * look exactly like an ephemeris error in whichever one was wrong -- a planet
 * a degree from where the star chart puts it, with nothing to say which was
 * lying.
 */
export function equatorialToVector(raDeg, decDeg, lstHours, latDeg, precess = null) {
  // Sidereal time is of date, so the coordinates have to be too. Anything
  // catalogued in J2000 -- the stars, the planets, the galactic frame -- comes
  // through here with the precession matrix for the moment being drawn. The
  // Moon does not: its series is already of date, and precessing it twice
  // would move it 22 arcminutes the other way.
  if (precess) ({ ra: raDeg, dec: decDeg } = precessEquatorial(precess, raDeg, decDeg));
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const ha = (lstHours * 15 - raDeg) * DEG;
  const dec = decDeg * DEG;
  const sinDec = Math.sin(dec), cosDec = Math.cos(dec);
  const sinAlt = sinDec * sinLat + cosDec * cosLat * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-cosDec * cosLat * Math.sin(ha),
                        sinDec - sinLat * sinAlt);
  const c = Math.cos(alt);
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)];
}

export function buildSkyVectors(stars, lstHours, latDeg, limitMag = 5.5, precess = null) {
  const out = [];
  for (const s of stars) {
    const [raDeg, decDeg, mag, bv, hr] = s;
    if (mag > limitMag) continue;
    out.push({ v: equatorialToVector(raDeg, decDeg, lstHours, latDeg, precess), mag, bv, hr });
  }
  return out;
}

/**
 * The planets and the Moon, placed in the sky the same way the stars are.
 *
 * Each keeps whatever it arrived with -- name, colour, magnitude, phase -- and
 * gains a direction, an altitude and an azimuth. Anything below the horizon is
 * dropped here rather than at drawing time: something under your feet is not
 * "off the edge of the view", it is on the other side of the planet, and an
 * arrow pointing helpfully at the ground is worse than silence.
 */
export function buildBodies(bodies, lstHours, latDeg, precess = null) {
  const out = [];
  for (const b of bodies) {
    // A body that says it is already of date -- the Moon -- is left alone.
    const p = b.frame === 'date' ? null : precess;
    const v = equatorialToVector(b.ra, b.dec, lstHours, latDeg, p);
    const { alt, az } = vectorToAltAz(v);
    // Two neighbours a quarter-degree away, toward celestial north and
    // celestial east. Projecting those alongside the body itself gives the
    // directions north and east point ON SCREEN, wherever the view is turned,
    // which is what a position angle is measured against.
    //
    // Measured rather than reasoned about ON PURPOSE. Working out which way
    // east runs in a projection of the sky -- seen from inside, not from
    // outside like a map -- is a handedness argument that is very easy to get
    // backwards, and a mirrored crescent is wrong in a way people notice
    // instantly without being able to say why.
    const dec = Math.min(89.5, Math.max(-89.5, b.dec));
    const vNorth = equatorialToVector(b.ra, dec + 0.25, lstHours, latDeg, p);
    const vEast = equatorialToVector(
      b.ra + 0.25 / Math.cos(dec * DEG), dec, lstHours, latDeg, p);
    out.push({ ...b, v, alt, az, vNorth, vEast });
  }
  return out;
}

/**
 * A basis from a look direction rather than from a device.
 *
 * This is what makes the sky view usable without moving anything: buttons and
 * arrow keys drive an azimuth and altitude, and the same projection runs. On a
 * desktop there are no orientation sensors at all, and plenty of people cannot
 * hold a phone up and sweep it around -- which is most of the point of this
 * app -- so pointing must never be the only way to look at the sky.
 *
 * @param {number} azDeg    where to look, degrees true
 * @param {number} altDeg   how high, degrees
 * @param {number} rollDeg  rotation about the view axis
 */
export function basisFromAim(azDeg, altDeg, rollDeg = 0) {
  // Straight up and straight down have no defined "which way is up" on screen,
  // and the cross products below collapse there. Stopping just short keeps the
  // view continuous instead of flipping as it crosses the zenith.
  const alt = Math.max(-89.9, Math.min(89.9, altDeg));
  const forward = altAzToVector(alt, azDeg);

  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  let right = norm(cross(forward, [0, 0, 1]));
  let up = norm(cross(right, forward));

  if (rollDeg) {
    const r = rollDeg * DEG, c = Math.cos(r), s = Math.sin(r);
    const nr = right.map((v, i) => v * c + up[i] * s);
    const nu = right.map((v, i) => -v * s + up[i] * c);
    right = nr; up = nu;
  }
  return { right, up, forward };
}

/**
 * Rotate a basis for the screen's own orientation.
 *
 * DeviceOrientation reports against the DEVICE, which does not turn when the
 * screen does. Hold a phone in landscape and the device's "up" is still the
 * short edge, so an uncorrected view is rotated ninety degrees and every
 * left/right instruction is wrong. screen.orientation.angle is how much the
 * screen has turned relative to the device, so undoing it puts the sky back.
 *
 * Only right and up change: what the phone is AIMED at does not depend on
 * which way the picture is drawn.
 */
export function applyScreenAngle(basis, angleDeg) {
  if (!angleDeg) return basis;
  const a = -angleDeg * DEG, c = Math.cos(a), s = Math.sin(a);
  const { right, up, forward } = basis;
  return {
    right: right.map((v, i) => v * c + up[i] * s),
    up: right.map((v, i) => -v * s + up[i] * c),
    forward,
  };
}

/**
 * Smooth an angle in degrees, the long way round being wrong.
 *
 * Averaging 359 and 1 the obvious way gives 180 -- the sky would swing to the
 * opposite horizon every time the heading crossed north. Interpolating the
 * unit vector instead has no seam.
 *
 * @param {number|null} prev  the smoothed value so far
 * @param {number} next       the new raw reading
 * @param {number} k          0 = never move, 1 = no smoothing at all
 */
export function smoothAngle(prev, next, k = 0.25) {
  if (prev == null || Number.isNaN(prev)) return next;
  const p = prev * DEG, n = next * DEG;
  const x = Math.cos(p) + (Math.cos(n) - Math.cos(p)) * k;
  const y = Math.sin(p) + (Math.sin(n) - Math.sin(p)) * k;
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

/**
 * Altitude from tilt, for a phone that can be raised but not swept.
 *
 * The pointing convention elsewhere -- alt = beta - 90 -- assumes you can aim
 * the BACK of the phone at a patch of sky, which needs the phone held up and
 * turned. Someone who can lift a phone from flat to vertical but cannot sweep
 * it left and right has ninety degrees of pitch and no yaw, so that convention
 * spends their whole range getting from the ground to the horizon and leaves
 * nothing for the sky.
 *
 * This maps the range they actually have onto the range that matters:
 *
 *     flat on the bed (beta 0)   ->  the horizon
 *     straight up     (beta 90)  ->  the zenith
 *
 * Azimuth then comes from the buttons, which is the axis they cannot drive.
 */
export function altitudeFromTilt(betaDeg) {
  if (betaDeg == null || Number.isNaN(betaDeg)) return null;
  return Math.max(0, Math.min(89, Math.abs(betaDeg)));
}

// --- the Milky Way ----------------------------------------------------------
//
// Drawn because it is what most people are pointing a tracker AT. Knowing
// where the band runs -- and where its bright core in Sagittarius sits -- is
// the difference between framing a shot and hunting for one.
//
// The band is the galactic plane, so it is drawn from galactic coordinates
// rotated into the sky rather than traced by hand. Two directions define that
// rotation, both J2000:
//
//   galactic north pole   RA 192.85948   Dec +27.12825
//   galactic centre       RA 266.40499   Dec -28.93617   (Sgr A*)
//
// Everything else follows, which means the band cannot drift out of step with
// the stars drawn on top of it.

const GAL_POLE_RA = 192.85948, GAL_POLE_DEC = 27.12825;
const GAL_CENTRE_RA = 266.40499, GAL_CENTRE_DEC = -28.93617;

function raDecToVec(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG, c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

const GZ = raDecToVec(GAL_POLE_RA, GAL_POLE_DEC);
const GX = (() => {
  // The centre direction is not exactly perpendicular to the pole once both
  // are rounded, so it is orthogonalised rather than trusted -- otherwise the
  // frame is very slightly skewed and the band leans.
  const c = raDecToVec(GAL_CENTRE_RA, GAL_CENTRE_DEC);
  const d = c[0] * GZ[0] + c[1] * GZ[1] + c[2] * GZ[2];
  const v = [c[0] - d * GZ[0], c[1] - d * GZ[1], c[2] - d * GZ[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const GY = [
  GZ[1] * GX[2] - GZ[2] * GX[1],
  GZ[2] * GX[0] - GZ[0] * GX[2],
  GZ[0] * GX[1] - GZ[1] * GX[0],
];

/** Galactic longitude and latitude to equatorial right ascension and declination. */
export function galacticToEquatorial(lDeg, bDeg) {
  const l = lDeg * DEG, b = bDeg * DEG, cb = Math.cos(b);
  const g = [cb * Math.cos(l), cb * Math.sin(l), Math.sin(b)];
  const v = [
    GX[0] * g[0] + GY[0] * g[1] + GZ[0] * g[2],
    GX[1] * g[0] + GY[1] * g[1] + GZ[1] * g[2],
    GX[2] * g[0] + GY[2] * g[1] + GZ[2] * g[2],
  ];
  return {
    ra: ((Math.atan2(v[1], v[0]) / DEG) % 360 + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
  };
}

/**
 * How bright the band is at a galactic longitude and latitude, 0..1.
 *
 * Not a photometric model -- a legible one. It falls off away from the plane,
 * and is far brighter toward the centre in Sagittarius than toward the
 * anticentre, which is what the eye and a camera both see.
 */
export function milkyWayBrightness(lDeg, bDeg) {
  const towardCentre = Math.cos(lDeg * DEG);            // +1 centre, -1 anti
  const core = 0.35 + 0.65 * ((towardCentre + 1) / 2) ** 1.7;
  const acrossPlane = Math.exp(-((bDeg / 11) ** 2));    // fades out by ~20 deg
  return Math.max(0, Math.min(1, core * acrossPlane));
}

/** The band as horizontal-coordinate patches, ready to project. */
export function buildMilkyWay(lstHours, latDeg, stepL = 6, stepB = 3, maxB = 18,
                              precess = null) {
  const out = [];
  for (let l = 0; l < 360; l += stepL) {
    for (let b = -maxB; b <= maxB; b += stepB) {
      const a = milkyWayBrightness(l, b);
      if (a < 0.06) continue;
      // The galactic frame is defined in J2000, so the band is precessed like
      // the stars it is drawn behind. This used to carry its own copy of the
      // horizontal rotation -- a third one -- and now goes through the same
      // function as everything else.
      const { ra, dec } = galacticToEquatorial(l, b);
      out.push({ v: equatorialToVector(ra, dec, lstHours, latDeg, precess), a, l, b });
    }
  }
  return out;
}

/**
 * Where the view is allowed to point.
 *
 * Pure, and here rather than in app.js, because this rule has now produced a
 * user-visible bug -- "when clicking ISS it would jump to it ... now it just
 * stops here" -- while living somewhere no test could reach it. The floor is
 * passed in rather than decided here: how far down you may WANDER and how far
 * down you may be SENT are different questions, and the caller is the only
 * one that knows which it is asking.
 */
export function clampAim(az, alt, floor, ceiling = 89) {
  return {
    az: ((az % 360) + 360) % 360,
    alt: Math.max(floor, Math.min(ceiling, alt)),
  };
}
