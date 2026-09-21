import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitOrbit, issEcefAt, issLookAt, orbitPath, geodeticToEcef, lookAnglesEcef,
} from '../site/src/iss.js';
import { gmstHours, julianDay } from '../site/src/astro.js';

// POINTING AN ARROW AT THE STATION MEANS KNOWING WHERE IT IS *NOW*.
//
// "Find the ISS" fetches a handful of positions and the app then has to keep
// pointing at the station between fetches. It moves about a degree of look
// angle per second during a close pass, so last fetch's position is not an
// answer -- an arrow aimed at where it was thirty seconds ago points at empty
// sky.
//
// There are no orbital elements available offline, only positions, so the
// orbit is recovered from the positions themselves: a plane, a radius, and an
// angular rate measured from the sample times. The station's orbit is very
// nearly circular (e ~ 0.0003), so a circle is good to a few km over the
// minutes of a pass, which is far inside what an arrow can express.
//
// These tests build samples from a KNOWN circular orbit and check the fit
// recovers it -- including between samples and beyond the last one, which is
// the case the app actually runs in.

const DEG = Math.PI / 180;
const A = 6378.137, F = 1 / 298.257223563, E2 = F * (2 - F);

/**
 * ECEF -> geodetic, so a synthetic orbit can be expressed the way the tracker
 * expresses one. Test-local on purpose: production only ever needs the
 * forward direction, and an unused inverse in the app is a thing to maintain.
 */
function ecefToGeodetic(p) {
  const lon = Math.atan2(p[1], p[0]);
  const r = Math.hypot(p[0], p[1]);
  let lat = Math.atan2(p[2], r * (1 - E2)), h = 0;
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(lat);
    const N = A / Math.sqrt(1 - E2 * s * s);
    h = r / Math.cos(lat) - N;
    lat = Math.atan2(p[2], r * (1 - E2 * (N / (N + h))));
  }
  return { lat: lat / DEG, lon: lon / DEG, heightKm: h };
}

const spinZ = (v, a) => [
  v[0] * Math.cos(a) - v[1] * Math.sin(a),
  v[0] * Math.sin(a) + v[1] * Math.cos(a),
  v[2],
];

// A known circular orbit: 51.6 degrees inclined, ~420 km up, 92.9 min period.
const INCL = 51.6 * DEG;
const RADIUS = A + 420;
const PERIOD = 92.9 * 60;
const RATE = (2 * Math.PI) / PERIOD;
const T0 = new Date('2026-03-15T22:10:00Z');

// In-plane basis: u on the ascending node, w a quarter turn along the motion.
const U = [1, 0, 0];
const W = [0, Math.cos(INCL), Math.sin(INCL)];

/** True Earth-fixed position of the synthetic station at an instant. */
function truthEcef(when) {
  const a = RATE * ((when.getTime() - T0.getTime()) / 1000);
  const ca = Math.cos(a), sa = Math.sin(a);
  const eci = [
    RADIUS * (ca * U[0] + sa * W[0]),
    RADIUS * (ca * U[1] + sa * W[1]),
    RADIUS * (ca * U[2] + sa * W[2]),
  ];
  return spinZ(eci, -gmstHours(julianDay(when)) * 15 * DEG);
}

/** The sample list the tracker would have returned for that orbit. */
function samplesOver(minutes, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(T0.getTime() + (i * minutes * 60000) / (count - 1));
    out.push({ ...ecefToGeodetic(truthEcef(at)), at });
  }
  return out;
}

const kmApart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('the synthetic orbit survives the round trip through geodetic', () => {
  // If this drifts, every tolerance below is measuring the test's own error
  // rather than the fit's.
  const at = new Date(T0.getTime() + 123456);
  const p = truthEcef(at);
  const g = ecefToGeodetic(p);
  assert.ok(kmApart(geodeticToEcef(g.lat, g.lon, g.heightKm), p) < 1e-6,
    'the test helper does not round-trip');
});

test('the fit recovers the orbital rate from the sample times', () => {
  // The unwrapping is the part that breaks: samples spanning most of an orbit
  // fold back through -pi, and an un-unwrapped fit reports a rate near zero --
  // an orbit that appears to stand still.
  const fit = fitOrbit(samplesOver(80, 10));
  const period = (2 * Math.PI) / Math.abs(fit.rate);
  assert.ok(Math.abs(period - PERIOD) < 5,
    `recovered period ${(period / 60).toFixed(2)} min, expected 92.9`);
  assert.ok(fit.rate > 0, 'the fit must run the same way round as the samples');
});

test('the fit reproduces the samples it was built from', () => {
  const samples = samplesOver(80, 10);
  const fit = fitOrbit(samples);
  for (const s of samples) {
    const d = kmApart(issEcefAt(fit, s.at), geodeticToEcef(s.lat, s.lon, s.heightKm));
    assert.ok(d < 1, `sample reproduced ${d.toFixed(3)} km out`);
  }
});

test('it holds between the samples, where nothing was measured', () => {
  // The app asks for instants that are not sample times -- that is the whole
  // point -- so interpolation accuracy is the real requirement.
  const fit = fitOrbit(samplesOver(80, 10));
  for (let m = 0; m <= 80; m += 3.7) {
    const at = new Date(T0.getTime() + m * 60000);
    const d = kmApart(issEcefAt(fit, at), truthEcef(at));
    assert.ok(d < 1, `at +${m.toFixed(1)} min the fit is ${d.toFixed(3)} km out`);
  }
});

test('it still points somewhere sane a few minutes past the last sample', () => {
  // A pass lasts minutes and the samples may already be behind; extrapolation
  // is expected to degrade, but it must not fall apart.
  const fit = fitOrbit(samplesOver(80, 10));
  for (const m of [85, 90, 100]) {
    const at = new Date(T0.getTime() + m * 60000);
    const d = kmApart(issEcefAt(fit, at), truthEcef(at));
    assert.ok(d < 5, `extrapolating to +${m} min was ${d.toFixed(2)} km out`);
  }
});

test('the look angle says below the horizon rather than withholding it', () => {
  // "It is under your feet" is a real answer to "where is it". Refusing to say
  // so leaves someone turning on the spot looking for something that is not in
  // the sky at all -- which is exactly the case the arrow has to handle.
  const samples = samplesOver(80, 10);
  const observer = { lat: 30.06, lon: -95.21, heightKm: 0.026 };
  let sawBelow = false;
  for (let m = 0; m <= 90; m += 1) {
    const look = issLookAt(samples, observer, new Date(T0.getTime() + m * 60000));
    assert.ok(look, 'a fitted orbit must always yield a look angle');
    assert.equal(typeof look.alt, 'number');
    assert.ok(look.az >= 0 && look.az < 360, `azimuth out of range: ${look.az}`);
    assert.equal(look.aboveHorizon, look.alt > 0);
    if (look.alt < 0) sawBelow = true;
  }
  assert.ok(sawBelow, 'over 90 minutes the station must pass below the horizon');
});

test('the propagated position agrees with the direct look angle', () => {
  // The user-facing quantity. Propagating to a sample's own time must give the
  // same answer as reading that sample straight off the tracker.
  const samples = samplesOver(80, 10);
  const observer = { lat: 30.06, lon: -95.21, heightKm: 0.026 };
  for (const s of samples) {
    const direct = lookAnglesEcef(observer, geodeticToEcef(s.lat, s.lon, s.heightKm));
    const viaFit = issLookAt(samples, observer, s.at);
    assert.ok(Math.abs(direct.alt - viaFit.alt) < 0.2,
      `altitude differs by ${Math.abs(direct.alt - viaFit.alt).toFixed(3)}°`);
  }
});

test('too few samples is null, not a confident wrong answer', () => {
  const observer = { lat: 30.06, lon: -95.21, heightKm: 0.026 };
  assert.equal(issLookAt(null, observer, T0), null);
  assert.equal(issLookAt(samplesOver(10, 2).slice(0, 2), observer, T0), null);
});

test('orbitPath still draws a closed ring of the right size', () => {
  // fitOrbit was factored out of orbitPath; this is the guard that the drawing
  // half did not change behaviour when it started sharing the fit.
  const path = orbitPath(samplesOver(80, 10), T0, 60);
  assert.equal(path.length, 61, 'the loop must be closed');
  for (const p of path) {
    const r = Math.hypot(p[0], p[1], p[2]);
    assert.ok(Math.abs(r - RADIUS) < 2, `ring radius ${r.toFixed(1)} km`);
  }
});
