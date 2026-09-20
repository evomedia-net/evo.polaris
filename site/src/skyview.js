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
export function buildSkyVectors(stars, lstHours, latDeg, limitMag = 5.5) {
  const out = [];
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  for (const s of stars) {
    const [raDeg, decDeg, mag, bv, hr] = s;
    if (mag > limitMag) continue;
    const ha = (lstHours * 15 - raDeg) * DEG;
    const dec = decDeg * DEG;
    const sinDec = Math.sin(dec), cosDec = Math.cos(dec);
    const sinAlt = sinDec * sinLat + cosDec * cosLat * Math.cos(ha);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const az = Math.atan2(-cosDec * cosLat * Math.sin(ha),
                          sinDec - sinLat * sinAlt);
    const c = Math.cos(alt);
    out.push({
      v: [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)],
      mag, bv, hr,
    });
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
export function buildMilkyWay(lstHours, latDeg, stepL = 6, stepB = 3, maxB = 18) {
  const out = [];
  for (let l = 0; l < 360; l += stepL) {
    for (let b = -maxB; b <= maxB; b += stepB) {
      const a = milkyWayBrightness(l, b);
      if (a < 0.06) continue;
      const { ra, dec } = galacticToEquatorial(l, b);
      const ha = (lstHours * 15 - ra) * DEG;
      const d = dec * DEG, lat = latDeg * DEG;
      const sinAlt = Math.sin(d) * Math.sin(lat)
        + Math.cos(d) * Math.cos(lat) * Math.cos(ha);
      const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
      const az = Math.atan2(-Math.cos(d) * Math.cos(lat) * Math.sin(ha),
                            Math.sin(d) - Math.sin(lat) * sinAlt);
      const c = Math.cos(alt);
      out.push({
        v: [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)],
        a, l, b,
      });
    }
  }
  return out;
}
