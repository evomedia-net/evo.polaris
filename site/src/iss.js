// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Where the International Space Station is, right now.
//
// THIS IS THE ONE FEATURE THAT CANNOT WORK OFFLINE, and that is worth stating
// plainly rather than discovering in a field. Stars are fixed for centuries
// and the magnetic model is good for five years, so both ship inside the app.
// The ISS is somewhere different every second and its orbit is nudged by drag
// and by reboosts, so its position cannot be bundled -- it has to be asked
// for. Everything else in this app keeps working with the radio off; this does
// not, and it says so instead of failing quietly.
//
// WHAT THIS DOES NOT DO: predict passes. "It rises in the north-west at 21:04
// for four minutes" is the genuinely useful thing for photography, and it
// needs SGP4 propagation from a fresh orbital element set -- an orbital
// mechanics library's worth of code, and elements that go stale in days.
// Showing where it is now is a fraction of that work and honest about being
// less. Pass prediction is a separate, much larger job.

import { gmstHours, julianDay } from './astro.js';

const DEG = Math.PI / 180;

// WGS-84, the same ellipsoid the magnetic model uses.
const A = 6378.137;             // equatorial radius, km
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

/** Geodetic latitude, longitude and height to Earth-centred, Earth-fixed km. */
export function geodeticToEcef(latDeg, lonDeg, heightKm) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const s = Math.sin(lat), c = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);          // radius of curvature
  return [
    (n + heightKm) * c * Math.cos(lon),
    (n + heightKm) * c * Math.sin(lon),
    (n * (1 - E2) + heightKm) * s,
  ];
}

/**
 * Where a satellite appears from an observer: altitude, azimuth and range.
 *
 * Both positions are geodetic. The difference vector is rotated into the
 * observer's east/north/up frame, which is what "look up 40 degrees, turn to
 * 210" actually means.
 *
 * A NEGATIVE ALTITUDE IS NORMAL AND MUST BE REPORTED, not clamped: most of the
 * time the station is below the horizon, on the other side of the planet, and
 * an app that draws it anyway is inventing a sighting.
 */
export function lookAngles(observer, target) {
  return lookAnglesEcef(observer,
    geodeticToEcef(target.lat, target.lon, target.heightKm || 0));
}

/**
 * The same look angles, for a target already in Earth-fixed coordinates.
 *
 * The orbit path is generated as ECEF points rather than as latitudes and
 * longitudes, and round-tripping them through geodetic just to come back here
 * would be two conversions that cancel -- and one of them, ECEF to geodetic,
 * is iterative.
 */
export function lookAnglesEcef(observer, t) {
  const o = geodeticToEcef(observer.lat, observer.lon, observer.heightKm || 0);
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];

  const lat = observer.lat * DEG, lon = observer.lon * DEG;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);

  const east = -sLon * d[0] + cLon * d[1];
  const north = -sLat * cLon * d[0] - sLat * sLon * d[1] + cLat * d[2];
  const up = cLat * cLon * d[0] + cLat * sLon * d[1] + sLat * d[2];

  const range = Math.hypot(east, north, up);
  return {
    alt: Math.asin(up / range) / DEG,
    az: ((Math.atan2(east, north) / DEG) % 360 + 360) % 360,
    rangeKm: range,
    aboveHorizon: up > 0,
  };
}

/**
 * Ask where the station is. Requires the network, by nature.
 *
 * @param {function} [fetchFn] injectable for tests
 */
export async function fetchIss(fetchFn = fetch) {
  const res = await fetchFn('https://api.wheretheiss.at/v1/satellites/25544',
    { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') {
    throw new Error('no position in the response');
  }
  return {
    lat: d.latitude,
    lon: d.longitude,
    heightKm: d.altitude,
    // "eclipsed" means it is in the Earth's shadow: up, but unlit and
    // invisible. Drawing a marker without saying so sends someone outside to
    // look for a thing that is not shining.
    sunlit: d.visibility === 'daylight',
    visibility: d.visibility,
    velocityKmh: d.velocity,
    at: new Date((d.timestamp || Date.now() / 1000) * 1000),
  };
}

// --- the orbit it is on -----------------------------------------------------
//
// STILL NO ORBIT PROPAGATION HERE. The tracker will return positions for any
// timestamps you ask for, up to ten at a time, so one request buys ten points
// spread over a full orbit -- propagated by the people who do that properly.
// What this module does with them is geometry, not dynamics: ten points on a
// circle determine the circle.
//
// WHY FIT A PLANE INSTEAD OF JOINING THE DOTS. Ten points across ninety-three
// minutes are nineteen minutes apart, and a line through them is a polygon
// with 36-degree corners -- in a 65-degree field that reads as a broken path
// rather than an orbit. The points all lie on one plane through the centre of
// the Earth, which is what an orbit IS, so fitting that plane and drawing the
// whole circle is both smoother and more honest than interpolating.
//
// The samples are rotated into an inertial frame first. In Earth-fixed
// coordinates they do NOT lie on a plane -- the Earth turns 23 degrees under
// the station during one orbit, which is exactly why its ground track marches
// west across the map.

const ISS_ORBIT_MINUTES = 92.9;

/** Earth-fixed to inertial, and back, by the Greenwich sidereal angle. */
function spinZ(v, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

/**
 * Ask the tracker for one orbit's worth of positions, in a single request.
 *
 * @param {function} [fetchFn] injectable for tests
 * @param {Date} [from] the instant to centre the orbit on
 */
export async function fetchIssTrack(fetchFn = fetch, from = new Date(), count = 10) {
  const step = (ISS_ORBIT_MINUTES * 60) / count;
  const base = Math.floor(from.getTime() / 1000);
  const stamps = [];
  for (let i = 0; i < count; i++) {
    stamps.push(Math.round(base + (i - count / 2) * step));
  }
  const res = await fetchFn(
    'https://api.wheretheiss.at/v1/satellites/25544/positions'
    + `?timestamps=${stamps.join(',')}&units=kilometers`, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 3) {
    throw new Error('not enough positions to fit an orbit');
  }
  return rows
    .filter((d) => typeof d.latitude === 'number' && typeof d.longitude === 'number')
    .map((d) => ({
      lat: d.latitude,
      lon: d.longitude,
      heightKm: d.altitude,
      at: new Date(d.timestamp * 1000),
    }));
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The circle the samples lie on, and how fast the station runs round it.
 *
 * Returns the orbit in its own terms: a plane, a radius, an in-plane basis
 * anchored on the FIRST sample, and an angular rate. Everything else here is
 * a projection of that.
 *
 * WHY A FIT AND NOT A PROPAGATOR. There is no orbital element set available
 * offline -- only a handful of positions from the tracker -- so the orbit is
 * recovered from the positions themselves. The station's orbit is very nearly
 * circular (eccentricity about 0.0003), so a circle through the samples is
 * good to a few km, which is far inside what an arrow on a phone can express.
 * It is a poor model over hours and a fine one over the minutes of a pass.
 *
 * The rate is measured from the samples rather than taken from the nominal
 * 92.9-minute period, so it carries whatever the real orbit is doing.
 */
export function fitOrbit(samples) {
  // Earth-fixed -> inertial, each at its own sidereal angle.
  const eci = samples.map((s) => ({
    p: spinZ(geodeticToEcef(s.lat, s.lon, s.heightKm),
             gmstHours(julianDay(s.at)) * 15 * DEG),
    at: s.at,
  }));

  // The plane's normal, averaged over every consecutive pair rather than taken
  // from one: a single cross product of two nearly-parallel samples is noisy,
  // and the tracker's positions carry their own small errors.
  let n = [0, 0, 0];
  for (let i = 0; i + 1 < eci.length; i++) {
    const c = cross(eci[i].p, eci[i + 1].p);
    // Keep every contribution pointing the same way round the orbit.
    const sign = (c[0] * n[0] + c[1] * n[1] + c[2] * n[2]) < 0 && i > 0 ? -1 : 1;
    n = [n[0] + sign * c[0], n[1] + sign * c[1], n[2] + sign * c[2]];
  }
  n = norm(n);

  const radius = eci.reduce(
    (a, v) => a + Math.hypot(v.p[0], v.p[1], v.p[2]), 0) / eci.length;
  const u = norm(eci[0].p);                 // angle zero, by construction
  const w = cross(n, u);

  // Where each sample sits round the circle, UNWRAPPED. Without unwrapping,
  // a set of samples spanning most of an orbit folds back through -pi and the
  // rate comes out near zero -- the orbit would appear to stand still.
  let prev = 0, turns = 0;
  const angles = eci.map((e, i) => {
    let a = Math.atan2(dot3(e.p, w), dot3(e.p, u));
    if (i > 0) {
      while (a + turns * 2 * Math.PI - prev < -Math.PI) turns += 1;
      while (a + turns * 2 * Math.PI - prev > Math.PI) turns -= 1;
      a += turns * 2 * Math.PI;
    }
    prev = a;
    return { a, t: (e.at.getTime() - eci[0].at.getTime()) / 1000 };
  });

  const last = angles[angles.length - 1];
  const rate = last.t !== 0
    ? (last.a - angles[0].a) / last.t
    : (2 * Math.PI) / (ISS_ORBIT_MINUTES * 60);

  return { n, u, w, radius, t0: eci[0].at, rate };
}

/** Where the station is at an instant, Earth-fixed, along the fitted circle. */
export function issEcefAt(fit, when) {
  const a = fit.rate * ((when.getTime() - fit.t0.getTime()) / 1000);
  const ca = Math.cos(a), sa = Math.sin(a);
  const p = [
    fit.radius * (ca * fit.u[0] + sa * fit.w[0]),
    fit.radius * (ca * fit.u[1] + sa * fit.w[1]),
    fit.radius * (ca * fit.u[2] + sa * fit.w[2]),
  ];
  return spinZ(p, -gmstHours(julianDay(when)) * 15 * DEG);
}

/**
 * Which way to look for the station RIGHT NOW, above the horizon or not.
 *
 * The altitude is returned negative rather than withheld when the station is
 * under your feet. That is deliberate: "it is below you and on the far side"
 * is a real answer to "where is it", and refusing to say so leaves someone
 * turning on the spot looking for something that is not in the sky at all.
 * Whether to DRAW anything there is the caller's decision, not this one's.
 */
export function issLookAt(samples, observer, when = new Date()) {
  if (!samples || samples.length < 3) return null;
  const l = lookAnglesEcef(observer, issEcefAt(fitOrbit(samples), when));
  return { alt: l.alt, az: l.az, aboveHorizon: l.alt > 0 };
}

/**
 * The circle those samples lie on, as Earth-fixed points for one instant.
 *
 * @returns {number[][]} ECEF positions, km, closed loop
 */
export function orbitPath(samples, when = new Date(), count = 180) {
  if (!samples || samples.length < 3) return [];
  const { u, w, radius } = fitOrbit(samples);
  const thetaNow = gmstHours(julianDay(when)) * 15 * DEG;
  const out = [];
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * 2 * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const p = [
      radius * (ca * u[0] + sa * w[0]),
      radius * (ca * u[1] + sa * w[1]),
      radius * (ca * u[2] + sa * w[2]),
    ];
    out.push(spinZ(p, -thetaNow));          // inertial -> Earth-fixed, now
  }
  return out;
}

/** The orbit as look angles from one place: what to draw. */
export function orbitLookAngles(samples, observer, when = new Date()) {
  return orbitPath(samples, when).map((p) => {
    const l = lookAnglesEcef(observer, p);
    return { alt: l.alt, az: l.az, up: l.alt > 0 };
  });
}

/** One sentence on whether it is worth going outside. */
export function describePass(look, iss) {
  if (!look.aboveHorizon) {
    return 'The ISS is below the horizon from here right now — it is on the '
      + 'other side of the Earth.';
  }
  const where = `${look.alt.toFixed(0)}° up, bearing ${look.az.toFixed(0)}°`;
  if (!iss.sunlit) {
    return `The ISS is above you (${where}) but in the Earth's shadow, so there `
      + 'is nothing to see — it only shines by reflected sunlight.';
  }
  return `The ISS is up and sunlit: ${where}, ${Math.round(look.rangeKm)} km away.`;
}
