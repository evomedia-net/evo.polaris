// Where the planets are.
//
// Computed, not fetched -- like the Moon and unlike the ISS. Planetary motion
// is known centuries ahead, so this keeps the app's promise of working in a
// field with the radio off.
//
// THE METHOD: JPL's approximate Keplerian elements, which give each planet's
// orbit as six numbers plus six rates of change per century. Propagate the
// elements to the date, solve Kepler's equation for the position in the orbit,
// rotate into the ecliptic, subtract the Earth's own position, and you have a
// geocentric direction.
//
// ACCURACY, STATED HONESTLY. This element set is published as good from 1800
// to 2050, and over that span it is worth a few arcminutes for the inner
// planets and better than an arcminute for the outer ones -- a small fraction
// of the Moon's width, and far finer than anyone can point a phone. It is not
// good enough to predict an occultation or a transit time, and it does not
// pretend to be: there is no perturbation theory here at all, only ellipses.
//
// WHAT IT DELIBERATELY LEAVES OUT: light-time correction (up to about 30
// minutes for Saturn, which moves it by well under an arcminute), aberration,
// and nutation. All are smaller than the element error they would be
// correcting inside.

const DEG = Math.PI / 180;
const OBLIQUITY = 23.43928 * DEG;       // J2000 mean obliquity

/**
 * Keplerian elements at J2000 and their rates per Julian century.
 *
 * Columns: semi-major axis (au), eccentricity, inclination (deg), mean
 * longitude (deg), longitude of perihelion (deg), longitude of the ascending
 * node (deg).
 *
 * From JPL's "Approximate Positions of the Planets" (Standish), the 1800-2050
 * set. The Earth row is the Earth-Moon barycentre, which is what the geocentric
 * subtraction wants -- the offset from there to the Earth's own centre is about
 * 4700 km, under two arcseconds at Mars's closest and invisible here.
 */
const ELEMENTS = {
  Mercury: {
    a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906],
    i: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175],
    peri: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081],
    colour: '#c9c2b8', mag0: -0.42,
  },
  Venus: {
    a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107],
    i: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729],
    peri: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418],
    colour: '#fff3d0', mag0: -4.40,
  },
  Earth: {
    a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392],
    i: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981],
    peri: [102.93768193, 0.32327364], node: [0.0, 0.0],
    colour: '#ffffff', mag0: 0,
  },
  Mars: {
    a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882],
    i: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499],
    peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343],
    colour: '#ff8a5c', mag0: -1.52,
  },
  Jupiter: {
    a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253],
    i: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775],
    peri: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106],
    colour: '#ffd9a0', mag0: -9.40,
  },
  Saturn: {
    a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991],
    i: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201],
    peri: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794],
    colour: '#f5e2a8', mag0: -8.88,
  },
  Uranus: {
    a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397],
    i: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785],
    peri: [170.95427630, 0.40805281], node: [74.01692503, 0.04240589],
    colour: '#a8e6ef', mag0: -7.19,
  },
  Neptune: {
    a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105],
    i: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325],
    peri: [44.96476227, -0.32241464], node: [131.78422574, -0.00508664],
    colour: '#8fb8ff', mag0: -6.87,
  },
};

/** The ones worth drawing, in order out from the Sun. Earth is not in the sky. */
export const PLANET_NAMES = [
  'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
];

export function planetColour(name) {
  return (ELEMENTS[name] || {}).colour || '#ffffff';
}

function centuriesSinceJ2000(date) {
  return (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
}

const wrap360 = (d) => ((d % 360) + 360) % 360;
/** To the range -180..180, which is what Kepler's equation wants. */
const wrap180 = (d) => wrap360(d + 180) - 180;

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly.
 *
 * Newton-Raphson. Every orbit here has e < 0.21, where this converges in a
 * handful of steps from E = M; the iteration cap is there so a future element
 * set with a wilder eccentricity fails slowly rather than hanging.
 */
function eccentricAnomaly(Mdeg, e) {
  const M = Mdeg * DEG;
  let E = M + e * Math.sin(M);
  for (let n = 0; n < 60; n++) {
    const dM = M - (E - e * Math.sin(E));
    const dE = dM / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * A planet's heliocentric position in the J2000 ecliptic frame, in au.
 *
 * @returns {{x:number,y:number,z:number,r:number}}
 */
export function heliocentric(name, date) {
  const el = ELEMENTS[name];
  if (!el) throw new Error(`no elements for ${name}`);
  const T = centuriesSinceJ2000(date);

  const a = el.a[0] + el.a[1] * T;
  const e = el.e[0] + el.e[1] * T;
  const I = (el.i[0] + el.i[1] * T) * DEG;
  const L = el.L[0] + el.L[1] * T;
  const peri = el.peri[0] + el.peri[1] * T;
  const node = (el.node[0] + el.node[1] * T) * DEG;

  // Argument of perihelion, and the mean anomaly it is measured from.
  const w = (peri - el.node[0] - el.node[1] * T) * DEG;
  const E = eccentricAnomaly(wrap180(L - peri), e);

  // Position in the orbital plane, perihelion along +x.
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(w), sw = Math.sin(w);
  const cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(I), si = Math.sin(I);

  const x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
  const y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;

  return { x, y, z, r: Math.hypot(x, y, z) };
}

/**
 * Apparent magnitude.
 *
 * The standard phase-angle polynomials. Saturn's is the weak one: its rings
 * contribute up to about 0.9 magnitudes depending on how open they are to us,
 * and that tilt is not modelled here, so Saturn can read up to a magnitude too
 * faint. It affects how big a dot gets drawn and nothing else.
 */
function magnitude(name, r, delta, phaseDeg) {
  const base = ELEMENTS[name].mag0 + 5 * Math.log10(r * delta);
  const i = phaseDeg;
  switch (name) {
    case 'Mercury':
      return base + 0.0380 * i - 0.000273 * i * i + 2e-6 * i * i * i;
    case 'Venus':
      return base + 0.0009 * i + 0.000239 * i * i - 6.5e-7 * i * i * i;
    case 'Mars': return base + 0.016 * i;
    case 'Jupiter': return base + 0.005 * i;
    default: return base;          // Saturn, Uranus, Neptune
  }
}

/**
 * Where a planet is as seen from the Earth.
 *
 * @returns {{name, ra, dec, distanceAu, elongation, phaseAngle, magnitude,
 *            eclipticLon, eclipticLat, colour}}
 */
export function planetPosition(name, date) {
  const p = heliocentric(name, date);
  const earth = heliocentric('Earth', date);

  const gx = p.x - earth.x, gy = p.y - earth.y, gz = p.z - earth.z;
  const delta = Math.hypot(gx, gy, gz);

  // Ecliptic to equatorial: one rotation about the vernal equinox.
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
  const ex = gx;
  const ey = gy * ce - gz * se;
  const ez = gy * se + gz * ce;

  // Phase angle at the planet, between the Sun and the Earth. The law of
  // cosines on the Sun-planet-Earth triangle, whose three sides are all known.
  const R = earth.r;
  const cosPhase = Math.min(1, Math.max(-1,
    (p.r * p.r + delta * delta - R * R) / (2 * p.r * delta)));
  const phase = Math.acos(cosPhase) / DEG;

  // Elongation: how far from the Sun it appears. This is the number that says
  // whether it is visible at all -- anything under about 15 degrees is lost in
  // twilight however bright it is.
  const cosElong = Math.min(1, Math.max(-1,
    (R * R + delta * delta - p.r * p.r) / (2 * R * delta)));

  return {
    name,
    ra: wrap360(Math.atan2(ey, ex) / DEG),
    dec: Math.asin(ez / delta) / DEG,
    distanceAu: delta,
    elongation: Math.acos(cosElong) / DEG,
    phaseAngle: phase,
    magnitude: magnitude(name, p.r, delta, phase),
    eclipticLon: wrap360(Math.atan2(gy, gx) / DEG),
    eclipticLat: Math.asin(gz / delta) / DEG,
    colour: ELEMENTS[name].colour,
  };
}

/** Every drawable planet at one instant. */
export function planetPositions(date) {
  return PLANET_NAMES.map((n) => planetPosition(n, date));
}

/**
 * One sentence on what is worth going outside for.
 *
 * Sorted by brightness, and it says where to look rather than listing
 * coordinates. A planet under 15 degrees from the Sun is called out as lost in
 * the twilight instead of being offered as a target.
 */
export function describePlanets(visible) {
  const up = visible.filter((p) => p.alt > 0);
  if (!up.length) return 'No planets are above the horizon right now.';

  const plural = (list, one, many) => (list.length > 1 ? many : one);
  const naked = up.filter((p) => p.magnitude < 6.0)
    .sort((a, b) => a.magnitude - b.magnitude);
  const faint = up.filter((p) => p.magnitude >= 6.0).map((p) => p.name);
  const parts = [];

  if (naked.length) {
    parts.push(`Up now: ${naked.map((p) =>
      `${p.name} at ${p.alt.toFixed(0)}° up, bearing ${p.az.toFixed(0)}°`)
      .join('; ')}.`);
    // Above the horizon is not the same as findable. Anything within about
    // twelve degrees of the Sun is in the glare whatever its magnitude says,
    // and offering it as a target sends someone out to look at nothing.
    const glare = naked.filter((p) => p.elongation < 12).map((p) => p.name);
    if (glare.length) {
      parts.push(`${glare.join(' and ')} ${plural(glare, 'is', 'are')} too close `
        + 'to the Sun to pick out.');
    }
  }
  if (faint.length) {
    parts.push(`${faint.join(' and ')} ${plural(faint, 'is', 'are')} up too, but `
      + `too faint for the naked eye — ${plural(faint, 'it needs', 'they need')} `
      + 'binoculars or a camera.');
  }
  return parts.join(' ');
}
