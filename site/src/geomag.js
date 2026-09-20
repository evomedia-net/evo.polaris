// World Magnetic Model 2025 -- magnetic declination.
//
// Why this is in the app at all: a phone compass reads MAGNETIC north, but a
// polar-aligned mount must point at TRUE north. The gap between them is up to
// ~20 deg in the continental US and changes with where you stand, so an arrow
// drawn from a raw compass heading can be pointing at open sky. We correct it
// on-device because the field has no internet.
//
// Spherical-harmonic synthesis to degree 12, per the WMM Technical Report.
// Validated against NOAA's own published test values -- see test/geomag.test.mjs.

import { WMM_COF, WMM_EPOCH } from './data/wmm2025.js';

const DEG = Math.PI / 180;
const NMAX = 12;

// Geomagnetic reference radius (km) and WGS-84 ellipsoid, as the model defines them.
const RE = 6371.2;
const A = 6378.137;
const B = 6356.7523142;

/** Parse the NOAA .COF text into main-field and secular-variation tables. */
function parseCof(text) {
  const g = [], h = [], gd = [], hd = [];
  for (let n = 0; n <= NMAX; n++) {
    g[n] = new Array(NMAX + 1).fill(0);
    h[n] = new Array(NMAX + 1).fill(0);
    gd[n] = new Array(NMAX + 1).fill(0);
    hd[n] = new Array(NMAX + 1).fill(0);
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('9999')) continue;
    const p = line.split(/\s+/);
    if (p.length !== 6) continue;             // the header line has 3 fields
    const n = +p[0], m = +p[1];
    if (!Number.isInteger(n) || n < 1 || n > NMAX || m > n) continue;
    g[n][m] = +p[2];
    h[n][m] = +p[3];
    gd[n][m] = +p[4];
    hd[n][m] = +p[5];
  }
  return { g, h, gd, hd };
}

const COEF = parseCof(WMM_COF);

/** Decimal year, e.g. 2026.72, from a Date. */
export function decimalYear(date) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/**
 * Magnetic field at a point.
 * @param {number} latDeg  geodetic latitude, north positive
 * @param {number} lonDeg  longitude, east positive
 * @param {number} altKm   height above the WGS-84 ellipsoid, km
 * @param {number} year    decimal year
 * @returns {{declination:number, inclination:number, h:number, x:number,
 *            y:number, z:number, f:number}} angles in degrees, field in nT
 */
export function magneticField(latDeg, lonDeg, altKm, year) {
  const dt = year - WMM_EPOCH;
  const { g, h: hc, gd, hd } = COEF;

  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const slat = Math.sin(lat), clat = Math.cos(lat);

  // Geodetic -> geocentric spherical (WMM Tech Report eq. 7-8).
  const a2 = A * A, b2 = B * B;
  const rc = Math.sqrt(a2 * clat * clat + b2 * slat * slat);   // radius of curvature
  const p = (altKm + a2 / rc) * clat;
  const zc = (altKm + b2 / rc) * slat;
  const r = Math.sqrt(p * p + zc * zc);
  const clatGc = p / r;                       // cos(geocentric colat complement)
  const slatGc = zc / r;                      // sin(geocentric latitude)
  const ct = slatGc;                          // cos(theta), theta = colatitude
  const st = clatGc;                          // sin(theta)

  // Schmidt semi-normalised associated Legendre functions and d/dtheta.
  const P = [], dP = [];
  for (let n = 0; n <= NMAX; n++) {
    P[n] = new Array(NMAX + 1).fill(0);
    dP[n] = new Array(NMAX + 1).fill(0);
  }
  P[0][0] = 1; dP[0][0] = 0;
  for (let n = 1; n <= NMAX; n++) {
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        // Schmidt quasi-normalisation carries a sqrt(2) for m >= 1, and it
        // enters the sectoral chain exactly once -- at P(1,1) = sin(theta).
        // Seeding this as sqrt(1/2)*sin(theta) leaves every m >= 1 term low by
        // sqrt(2), which shows up as a pure sqrt(2) error in the east component.
        const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
        P[n][n] = k * st * P[n - 1][n - 1];
        dP[n][n] = k * (st * dP[n - 1][n - 1] + ct * P[n - 1][n - 1]);
      } else {
        const k1 = (2 * n - 1) / Math.sqrt(n * n - m * m);
        const k2 = (n - 1 > 0 && m <= n - 2)
          ? Math.sqrt((n - 1) * (n - 1) - m * m) / Math.sqrt(n * n - m * m) : 0;
        const pPrev2 = (m <= n - 2) ? P[n - 2][m] : 0;
        const dPrev2 = (m <= n - 2) ? dP[n - 2][m] : 0;
        P[n][m] = k1 * ct * P[n - 1][m] - k2 * pPrev2;
        dP[n][m] = k1 * (ct * dP[n - 1][m] - st * P[n - 1][m]) - k2 * dPrev2;
      }
    }
  }

  const sm = [], cm = [];
  for (let m = 0; m <= NMAX; m++) { sm[m] = Math.sin(m * lon); cm[m] = Math.cos(m * lon); }

  let br = 0, bt = 0, bp = 0;
  for (let n = 1; n <= NMAX; n++) {
    const ar = Math.pow(RE / r, n + 2);
    for (let m = 0; m <= n; m++) {
      const gnm = g[n][m] + dt * gd[n][m];
      const hnm = hc[n][m] + dt * hd[n][m];
      const cosPart = gnm * cm[m] + hnm * sm[m];
      br += ar * (n + 1) * cosPart * P[n][m];
      bt -= ar * cosPart * dP[n][m];
      // B_phi = (1/sin t) * sum (a/r)^(n+2) * m * [g sin(m.lon) - h cos(m.lon)] P
      bp += ar * m * (gnm * sm[m] - hnm * cm[m]) * P[n][m];
    }
  }
  // B_phi carries a 1/sin(theta) that cancels against P's own sin(theta) factor
  // everywhere except exactly at the poles, where the component is undefined.
  bp = Math.abs(st) < 1e-10 ? 0 : bp / st;

  // Geocentric -> geodetic: rotate by the difference between the two latitudes.
  // psi is geodetic minus geocentric latitude: zero at the equator and poles,
  // ~0.19 deg near 45 deg. Getting its sign backwards leaves a latitude-shaped
  // error in X and Z while leaving Y untouched.
  const psi = lat - Math.atan2(slatGc, clatGc);
  const cpsi = Math.cos(psi), spsi = Math.sin(psi);
  const xg = -bt * cpsi - br * spsi;
  const zg = bt * spsi - br * cpsi;
  const yg = bp;

  const hh = Math.hypot(xg, yg);
  return {
    declination: Math.atan2(yg, xg) / DEG,
    inclination: Math.atan2(zg, hh) / DEG,
    h: hh, x: xg, y: yg, z: zg, f: Math.hypot(hh, zg),
  };
}

/**
 * Magnetic declination in degrees: add this to a magnetic compass heading to
 * get a true heading. East positive.
 */
export function declination(latDeg, lonDeg, altKm = 0, date = new Date()) {
  return magneticField(latDeg, lonDeg, altKm, decimalYear(date)).declination;
}

/** True heading from a magnetic compass reading, normalised to [0, 360). */
export function trueHeading(magneticHeading, latDeg, lonDeg, altKm = 0, date = new Date()) {
  return (magneticHeading + declination(latDeg, lonDeg, altKm, date) + 360) % 360;
}

/** The model is only valid for five years from its epoch. */
export function modelValidity() {
  return { epoch: WMM_EPOCH, validUntil: WMM_EPOCH + 5 };
}
