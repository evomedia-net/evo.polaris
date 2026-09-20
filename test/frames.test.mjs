import test from 'node:test';
import assert from 'node:assert/strict';
import {
  precessionMatrix, precessEquatorial, precessFromJ2000, equatorialToHorizontal,
  julianDay, lstHours, projectAroundPole, POLARIS,
} from '../site/src/astro.js';
import {
  buildSkyVectors, buildBodies, buildMilkyWay, vectorToAltAz, galacticToEquatorial,
} from '../site/src/skyview.js';
import { sunEquatorial, moonPosition } from '../site/src/moon.js';
import { heliocentric } from '../site/src/planets.js';

// REFERENCE FRAMES.
//
// Found by an independent audit: two Sun calculations written by different
// methods disagreed by 0.3676 degrees, and the general precession from J2000
// to the date was 0.3733. The methods agreed -- the frames did not. Everything
// drawn against sidereal time OF DATE has to be in the equinox of date, and
// the stars, the planets and the Milky Way were not.

const DEG = Math.PI / 180;
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);
// Chord between the two unit vectors, not acos of the dot product: acos loses
// everything near 1, and flagged a 4-milliarcsecond agreement as a failure.
const sep = (a, b) => {
  const v = (q) => {
    const d = q.dec * DEG, r = q.ra * DEG;
    return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
  };
  const [x, y] = [v(a), v(b)];
  const chord = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  return 2 * Math.asin(Math.min(1, chord / 2)) / DEG;
};
const azDiff = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

const WHEN = new Date('2026-09-20T02:00:00Z');
const JD = julianDay(WHEN);

test('the precession matrix is the validated precessFromJ2000, exactly', () => {
  // Same IAU-1976 angles, composed as a rotation. If a sign were flipped in
  // the composition this would be off by twice the precession, not by noise.
  const m = precessionMatrix(JD);
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const ra = (i * 37.7) % 360, dec = -89 + (i * 13.1) % 178;
    const a = precessFromJ2000(ra, dec, JD);
    const b = precessEquatorial(m, ra, dec);
    worst = Math.max(worst, sep(a, b));
  }
  assert.ok(worst < 1e-10, `matrix vs function differ by ${worst} deg`);
  // And it is a proper rotation: orthonormal, determinant +1.
  const dot = (r, c) => r[0] * c[0] + r[1] * c[1] + r[2] * c[2];
  near(dot(m[0], m[0]), 1, 1e-12, 'row 0 unit');
  near(dot(m[0], m[1]), 0, 1e-12, 'rows orthogonal');
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  near(det, 1, 1e-12, 'determinant');
});

test('the J2000 pole is 9 arcminutes from the pole of date in 2026', () => {
  // This IS the bug, as a number, at the pole. The pole itself moves by theta
  // -- about 20"/yr, 8.9' over 26.7 years -- while a star near the equator
  // moves by the full general precession of 50"/yr, 22'. The first draft of
  // this test expected 22' here and was wrong: the constant, not the code.
  const m = precessionMatrix(JD);
  const p = precessEquatorial(m, 0, 90);
  const off = (90 - p.dec) * 60;
  assert.ok(off > 8.5 && off < 9.4, `J2000 pole is ${off.toFixed(2)}' from the pole of date`);
  // And near the equator it really is 22'.
  const q = precessEquatorial(m, 0, 0);
  const eq = sep({ ra: 0, dec: 0 }, q) * 60;
  assert.ok(eq > 21.5 && eq < 23.5, `equatorial star moved ${eq.toFixed(2)}'`);
});

test('stars in the sky view go through the same precession Polaris does', () => {
  const lst = lstHours(JD, -95.2), lat = 30.06;
  const m = precessionMatrix(JD);
  const stars = [[POLARIS.raJ2000, POLARIS.decJ2000, 2.0, 0.6, 424], [88.79, 7.41, 0.5, 1.8, 2061]];
  const [pol, betel] = buildSkyVectors(stars, lst, lat, 6, m);
  for (const [s, v] of [[stars[0], pol], [stars[1], betel]]) {
    const ref = precessFromJ2000(s[0], s[1], JD);
    const hz = equatorialToHorizontal(ref.ra, ref.dec, lst, lat);
    const got = vectorToAltAz(v.v);
    near(got.alt, hz.alt, 1e-9, `alt of HR ${s[4]}`);
    near(azDiff(got.az, hz.az), 0, 1e-9, `az of HR ${s[4]}`);
  }
  // Polaris sits its REAL distance from the pole now -- 37.5' in 2026, not
  // the J2000 44.2'. The pole is at (alt = lat, az = 0).
  const pole = [0, Math.cos(lat * DEG), Math.sin(lat * DEG)];
  const d = Math.acos(pol.v[0] * pole[0] + pol.v[1] * pole[1] + pol.v[2] * pole[2]) / DEG * 60;
  assert.ok(d > 37 && d < 38.2, `Polaris drawn ${d.toFixed(2)}' from the pole; 2026 truth is ~37.5'`);
  const [unprecessed] = buildSkyVectors(stars, lst, lat, 6, null);
  const d0 = Math.acos(unprecessed.v[0] * pole[0] + unprecessed.v[1] * pole[1] + unprecessed.v[2] * pole[2]) / DEG * 60;
  assert.ok(d0 > 43.5 && d0 < 44.8, `without precession it was ${d0.toFixed(2)}' (J2000)`);
});

test('the Moon is left in its own frame, and the planets are not', () => {
  const lst = lstHours(JD, -95.2), lat = 30.06;
  const m = precessionMatrix(JD);
  const mp = moonPosition(WHEN);
  const [moon, planet] = buildBodies([
    { name: 'Moon', ra: mp.ra, dec: mp.dec, frame: 'date' },
    { name: 'Jupiter', ra: 60, dec: 20 },
  ], lst, lat, m);
  // Moon: exactly the unprecessed conversion, because it is already of date.
  const ref = equatorialToHorizontal(mp.ra, mp.dec, lst, lat);
  near(vectorToAltAz(moon.v).alt, ref.alt, 1e-9, 'Moon alt untouched');
  near(azDiff(vectorToAltAz(moon.v).az, ref.az), 0, 1e-9, 'Moon az untouched');
  // Planet: exactly the precessed conversion.
  const pj = precessFromJ2000(60, 20, JD);
  const refP = equatorialToHorizontal(pj.ra, pj.dec, lst, lat);
  near(vectorToAltAz(planet.v).alt, refP.alt, 1e-9, 'planet alt precessed');
  // And the two treatments differ by the 22' that was the bug.
  const refU = equatorialToHorizontal(60, 20, lst, lat);
  const moved = sep({ ra: 0, dec: refP.alt }, { ra: 0, dec: refU.alt }) * 60
    + azDiff(refP.az, refU.az) * Math.cos(refP.alt * DEG) * 60;
  assert.ok(moved > 10, `precession should move a planet visibly, moved ~${moved.toFixed(1)}'`);
});

test('the Sun agrees with itself across the two frames', () => {
  // The audit finding, made permanent. moon.js's Sun is of date; the JPL
  // Kepler Earth is J2000. Rotated into one frame they must agree closely.
  const m = precessionMatrix(JD);
  const e = heliocentric('Earth', WHEN);
  const lonJ2000 = ((Math.atan2(e.y, e.x) / DEG + 180) % 360 + 360) % 360;
  const eps = 23.43928 * DEG;
  // J2000 ecliptic (lon, 0) -> J2000 equatorial -> precess -> compare to of-date Sun
  const raJ = Math.atan2(Math.cos(eps) * Math.sin(lonJ2000 * DEG), Math.cos(lonJ2000 * DEG)) / DEG;
  const decJ = Math.asin(Math.sin(eps) * Math.sin(lonJ2000 * DEG)) / DEG;
  const sunViaKepler = precessEquatorial(m, raJ, decJ);
  const sunOfDate = sunEquatorial(WHEN);
  const d = sep(sunViaKepler, sunOfDate);
  assert.ok(d < 0.02, `two Suns ${(d * 60).toFixed(2)}' apart once in one frame; unprecessed they were 22'`);
});

test('the Milky Way is precessed with the stars it is drawn behind', () => {
  const lst = lstHours(JD, -95.2), lat = 30.06;
  const m = precessionMatrix(JD);
  const band = buildMilkyWay(lst, lat, 6, 3, 18, m);
  const centre = band.find((p) => p.l === 0 && p.b === 0);
  assert.ok(centre, 'the galactic centre patch is drawn');
  const { ra, dec } = galacticToEquatorial(0, 0);
  const pj = precessFromJ2000(ra, dec, JD);
  const ref = equatorialToHorizontal(pj.ra, pj.dec, lst, lat);
  near(vectorToAltAz(centre.v).alt, ref.alt, 1e-9, 'galactic centre alt');
});

test('the chart no longer draws the J2000 pole at its own centre', () => {
  // projectAroundPole with the precessed J2000 pole: 8.9' from the centre of
  // a 50-degree chart is a radius of 8.9/3000, not zero.
  const m = precessionMatrix(JD);
  const p = precessEquatorial(m, 0, 90);
  const q = projectAroundPole(p.ra, p.dec, 5, 50);
  const rArcmin = Math.hypot(q.x, q.y) * 50 * 60;
  assert.ok(rArcmin > 8.5 && rArcmin < 9.4, `J2000 pole plots ${rArcmin.toFixed(1)}' off centre`);
});
