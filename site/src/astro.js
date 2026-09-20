// Positional astronomy for polar alignment.
//
// Everything here is deliberately dependency-free and synchronous so it can run
// on a phone with no signal, in the dark, in a field.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Pole stars, ICRS J2000 from Hipparcos. The Bright Star Catalog we ship for
// the chart rounds positions to 0.1s / 1", which is fine for drawing dots and
// NOT fine for alignment, so alignment uses these values instead.
export const POLARIS = {
  raJ2000: (2 + 31 / 60 + 49.09 / 3600) * 15,   // degrees
  decJ2000: 89 + 15 / 60 + 50.8 / 3600,         // degrees
  pmRaCosDec: 44.48,                            // mas/yr
  pmDec: -11.85,                                // mas/yr
};

// Sigma Octantis, the southern pole star -- and it is a far worse one. At
// magnitude 5.47 it is roughly 25x fainter than Polaris (2.02) and sits about
// 63' from the pole rather than 38'. It is genuinely hard to see in a polar
// scope under anything but a dark sky, which is why southern alignment leans
// on the Southern Cross star-hop rather than on "just point at the pole star".
export const SIGMA_OCTANTIS = {
  raJ2000: (21 + 8 / 60 + 46.86 / 3600) * 15,
  decJ2000: -(88 + 57 / 60 + 23.4 / 3600),
  pmRaCosDec: 26.02,
  pmDec: 5.42,
};

/** Which pole an observer at this latitude aligns on. */
export function hemisphereOf(latDeg) {
  return latDeg < 0 ? 'south' : 'north';
}

/**
 * The pole star for a latitude, with the reticle ring range iOptron engraves
 * for it. The AccuAlign dial carries two groups of circles: 36'-44' for
 * Polaris and 60'-70' for Sigma Octantis.
 */
export function poleStarFor(latDeg) {
  return latDeg < 0
    ? { ...SIGMA_OCTANTIS, name: 'Sigma Octantis', short: 'σ Oct',
        hemisphere: 'south', magnitude: 5.47, rings: [60, 70] }
    : { ...POLARIS, name: 'Polaris', short: 'Polaris',
        hemisphere: 'north', magnitude: 2.02, rings: [36, 44] };
}

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function julianCenturies(jd) {
  return (jd - 2451545.0) / 36525.0;
}

/** Greenwich Mean Sidereal Time in hours, IAU 1982. */
export function gmstHours(jd) {
  const t = julianCenturies(jd);
  const deg = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * t * t - (t * t * t) / 38710000.0;
  return ((deg % 360) + 360) % 360 / 15;
}

/** Local Mean Sidereal Time in hours. East longitude positive. */
export function lstHours(jd, lonDegEast) {
  return ((gmstHours(jd) + lonDegEast / 15) % 24 + 24) % 24;
}

/**
 * Precess an ICRS/J2000 position to the equinox of date (IAU 1976), after
 * applying proper motion. Near the pole RA moves fast -- Polaris' RA shifts
 * about 0.3 deg a year -- so skipping this is a visible error, not a nicety.
 */
export function precessFromJ2000(raDeg, decDeg, jd, pmRaCosDec = 0, pmDec = 0) {
  const t = julianCenturies(jd);
  const years = (jd - 2451545.0) / 365.25;

  const dec0 = decDeg + (pmDec * years / 1000) / 3600;
  const ra0 = raDeg
    + ((pmRaCosDec / Math.cos(dec0 * DEG)) * years / 1000) / 3600;

  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600 * DEG;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600 * DEG;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600 * DEG;

  const r = ra0 * DEG, d = dec0 * DEG;
  const a = Math.cos(d) * Math.sin(r + zeta);
  const b = Math.cos(theta) * Math.cos(d) * Math.cos(r + zeta)
    - Math.sin(theta) * Math.sin(d);
  const c = Math.sin(theta) * Math.cos(d) * Math.cos(r + zeta)
    + Math.cos(theta) * Math.sin(d);

  return {
    ra: ((Math.atan2(a, b) + z) * RAD % 360 + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, c))) * RAD,
  };
}

/** Equatorial to horizontal. Azimuth measured from true north, east positive. */
export function equatorialToHorizontal(raDeg, decDeg, lstH, latDeg) {
  const ha = (lstH * 15 - raDeg) * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;

  const sinAlt = Math.sin(dec) * Math.sin(lat)
    + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(
    -Math.cos(dec) * Math.cos(lat) * Math.sin(ha),
    Math.sin(dec) - Math.sin(lat) * sinAlt,
  );
  return { alt: alt * RAD, az: ((az * RAD) % 360 + 360) % 360 };
}

/**
 * Bennett's atmospheric refraction, in degrees, for a true altitude.
 * Refraction lifts everything near the horizon; at the altitudes a polar
 * scope works at it is small but not zero.
 */
export function refraction(altDeg, pressureMbar = 1010, tempC = 10) {
  if (altDeg < -1) return 0;
  const r = 1.02 / Math.tan((altDeg + 10.3 / (altDeg + 5.11)) * DEG) / 60;
  return r * (pressureMbar / 1010) * (283 / (273 + tempC));
}

/**
 * Where to put Polaris in an iOptron AccuAlign polar scope.
 *
 * The reticle is a FULL CIRCLE labelled 0-12, so one dial-hour is 30 degrees,
 * while one hour of hour-angle is 15 degrees. Mapping hour-angle hours straight
 * onto dial hours is a silent factor-of-two error -- it is also why iOptron
 * tell Takahashi users to halve their 24-hour reading.
 *
 * @returns {{dialHour:number, dialMinute:number, dialDecimal:number,
 *            radiusArcmin:number, hourAngleHours:number, positionAngleDeg:number}}
 */
export function poleStarReticle(date, latDeg, lonDeg) {
  const star = poleStarFor(latDeg);
  const south = star.hemisphere === 'south';
  const jd = julianDay(date);
  const { ra, dec } = precessFromJ2000(
    star.raJ2000, star.decJ2000, jd, star.pmRaCosDec, star.pmDec,
  );
  const lst = lstHours(jd, lonDeg);
  const haHours = ((lst - ra / 15) % 24 + 24) % 24;

  // Position angle around the pole, measured from the 12 o'clock mark.
  //
  // The two hemispheres run in OPPOSITE directions. Looking north, the sky
  // turns anticlockwise about the NCP; looking south it turns clockwise about
  // the SCP. The polar scope inverts both identically, so the inversion
  // cancels out of the comparison and the dial simply runs the other way.
  //
  // HONESTY NOTE: the northern form is validated against iOptron's own
  // published worked example (see test/astro.test.mjs). The southern form is
  // NOT -- iOptron publish no southern vector, so it rests on the reasoning
  // above. The test pins the two as exact mirrors, which is the claim actually
  // being made. Confirm against Stellarium before trusting it in the field.
  const positionAngle = south
    ? ((180 + haHours * 15) % 360 + 360) % 360
    : ((180 - haHours * 15) % 360 + 360) % 360;
  const dialDecimal = positionAngle / 30;

  return {
    dialHour: Math.floor(dialDecimal),
    dialMinute: (dialDecimal - Math.floor(dialDecimal)) * 60,
    dialDecimal,
    // Distance from the pole: 90 - dec in the north, 90 + dec in the south,
    // since a southern pole star has a declination near -90.
    radiusArcmin: (south ? 90 + dec : 90 - dec) * 60,
    hourAngleHours: haHours,
    positionAngleDeg: positionAngle,
    star,
    hemisphere: star.hemisphere,
    ra,
    dec,
  };
}

/** Kept for the northern validation test, which anchors the whole method. */
export const polarisReticle = (date, latDeg, lonDeg) =>
  poleStarReticle(date, Math.abs(latDeg), lonDeg);

/**
 * The full set of numbers to dial into the mount.
 * @param {Date} date
 * @param {{lat:number, lon:number, altitude:number}} site  altitude in metres
 * @param {number} declinationDeg  magnetic declination, east positive
 */
export function alignmentSolution(date, site, declinationDeg) {
  const reticle = poleStarReticle(date, site.lat, site.lon);
  const jd = julianDay(date);
  const lst = lstHours(jd, site.lon);
  const polarisHz = equatorialToHorizontal(reticle.ra, reticle.dec, lst, site.lat);
  const south = reticle.hemisphere === 'south';

  // The mount's latitude scale is set to the observer's latitude -- the
  // magnitude of it, since the scale is not signed. That is what puts the RA
  // axis parallel to the Earth's. The pole's TRUE altitude equals the latitude
  // exactly; refraction only changes where it appears to be.
  const poleAltitude = Math.abs(site.lat);

  return {
    ...reticle,
    latitudeSetting: poleAltitude,
    poleApparentAltitude: poleAltitude + refraction(poleAltitude),
    // The mount points at the elevated pole: true north up north, true SOUTH
    // down south. Aiming a southern mount at 0 degrees is 180 degrees wrong.
    poleAzimuth: south ? 180 : 0,
    poleName: south ? 'true south' : 'true north',
    polarisAlt: polarisHz.alt,
    polarisAz: polarisHz.az,
    // Where the pole reads on a magnetic compass. A needle already points
    // declination degrees east of true north, so subtract it from the pole's
    // true bearing -- 0 in the north, 180 in the south.
    trueNorthOnCompass:
      (((south ? 180 : 0) - declinationDeg) % 360 + 360) % 360,
    declination: declinationDeg,
    lst,
  };
}

/**
 * Low-precision solar position (Astronomical Almanac), good to about 0.01 deg
 * through 2050 -- far better than needed to find north from a shadow.
 */
export function sunPosition(date) {
  const n = julianDay(date) - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD;
  return {
    ra: ((ra % 360) + 360) % 360,
    dec: Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD,
  };
}

/**
 * The moment the Sun crosses the local meridian -- the one instant in the day
 * when a vertical shadow points exactly true north (or true south, south of
 * the tropics). No compass, no instrument, no declination correction.
 *
 * Solved by iterating the Sun's hour angle to zero, which reuses the same
 * sidereal-time code the rest of the app is tested on.
 */
export function solarNoon(date, lonDeg) {
  // Start from an estimate of local noon, so we converge on the right day.
  let t = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12,
  ) - (lonDeg / 15) * 3600000);

  for (let i = 0; i < 5; i++) {
    const { ra } = sunPosition(t);
    let ha = ((lstHours(julianDay(t), lonDeg) - ra / 15) % 24 + 24) % 24;
    if (ha > 12) ha -= 24;                       // signed, -12..12 hours
    t = new Date(t.getTime() - ha * 3600000 * 0.9972695663);  // sidereal -> solar
  }
  return t;
}

/** Where the Sun is now, and where a vertical object's shadow falls. */
export function sunNow(date, latDeg, lonDeg) {
  const { ra, dec } = sunPosition(date);
  const { alt, az } = equatorialToHorizontal(
    ra, dec, lstHours(julianDay(date), lonDeg), latDeg,
  );
  return { alt, az, shadowAz: (az + 180) % 360, up: alt > -0.833 };
}

/**
 * Project about the north celestial pole for a chart you hold up while facing
 * north: up is the zenith, down is the horizon, and -- because you are facing
 * north rather than reading a map -- WEST is on the left and east on the right.
 *
 * A star at upper culmination (hour angle 0) is directly above the pole, so it
 * must land at the TOP. As its hour angle grows it moves west, which is to your
 * left, so x runs negative. Getting either sign wrong leaves a chart that is
 * quietly rotated or mirrored and sends you star-hopping the wrong way.
 *
 * Returns x,y in -1..1, or null if the star is outside the field.
 */
export function projectAroundPole(raDeg, decDeg, lstH, radiusDeg, south = false) {
  const r = south ? 90 + decDeg : 90 - decDeg;
  if (r > radiusDeg) return null;
  const ha = (lstH * 15 - raDeg) * DEG;
  const k = r / radiusDeg;
  // Handedness flips with the hemisphere. Facing NORTH, east is on your right
  // and west on your left; turn round to face SOUTH and they swap. Both charts
  // still put upper culmination at the top, so only x changes sign.
  return { x: (south ? k : -k) * Math.sin(ha), y: -k * Math.cos(ha) };
}
