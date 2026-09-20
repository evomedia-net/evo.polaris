import test from 'node:test';
import assert from 'node:assert/strict';
import {
  julianDay, gmstHours, lstHours, precessFromJ2000, equatorialToHorizontal,
  polarisReticle, POLARIS, refraction, projectAroundPole,
} from '../src/astro.js';

// --- independent anchors, so the chain is verified before the app relies on it

test('Julian Day matches the standard epoch', () => {
  // J2000.0 is 2000-01-01 12:00 TT ~= JD 2451545.0
  assert.ok(Math.abs(julianDay(new Date('2000-01-01T12:00:00Z')) - 2451545.0) < 1e-6);
});

test('GMST matches the textbook value at J2000', () => {
  // GMST at 2000-01-01 12:00 UT is 18h 41m 50.55s.
  const expected = 18 + 41 / 60 + 50.55 / 3600;
  const got = gmstHours(julianDay(new Date('2000-01-01T12:00:00Z')));
  assert.ok(Math.abs(got - expected) < 1 / 3600,
    `GMST ${got} vs ${expected}`);
});

test('sidereal time advances ~366.25 turns per year', () => {
  const a = gmstHours(julianDay(new Date('2026-01-01T00:00:00Z')));
  const b = gmstHours(julianDay(new Date('2026-01-02T00:00:00Z')));
  const gain = ((b - a) % 24 + 24) % 24;          // one sidereal day of slip
  assert.ok(Math.abs(gain - 0.0657098) < 0.001, `daily gain ${gain} h`);
});

test('precession moves Polaris toward the pole as expected', () => {
  // Polaris closes on the pole through the 21st century, reaching ~27' around
  // 2100. It must be monotonically closer in 2050 than in 2000.
  const at = (y) => {
    const { dec } = precessFromJ2000(
      POLARIS.raJ2000, POLARIS.decJ2000,
      julianDay(new Date(`${y}-01-01T00:00:00Z`)),
      POLARIS.pmRaCosDec, POLARIS.pmDec);
    return (90 - dec) * 60;
  };
  const r2000 = at(2000), r2026 = at(2026), r2050 = at(2050);
  assert.ok(Math.abs(r2000 - 44.15) < 0.2, `2000 radius ${r2000}'`);
  assert.ok(r2026 < r2000 && r2050 < r2026, 'must close on the pole');
  assert.ok(r2050 > 25 && r2050 < 40, `2050 radius ${r2050}' out of range`);
});

test('the celestial pole sits at an altitude equal to the latitude', () => {
  for (const lat of [0, 23.5, 42.5, 60, 89]) {
    const { alt } = equatorialToHorizontal(0, 90, 7.3, lat);
    assert.ok(Math.abs(alt - lat) < 1e-6, `lat ${lat} -> alt ${alt}`);
  }
});

test('refraction is small up high and large at the horizon', () => {
  assert.ok(refraction(90) < 0.01);
  assert.ok(refraction(45) > 0.005 && refraction(45) < 0.03);
  assert.ok(refraction(0) > 0.4 && refraction(0) < 0.7);   // ~34 arcmin
});

// --- the published iOptron vector ------------------------------------------
//
// From the SkyTracker Pro manual (#3322) sec 3: Boston, 2016-08-10 17:50:18
// local (EDT), N42 30'28" W71 08'49" -> "00hr 18.4m, Radius 40.2min".
//
// This is read off a screenshot in a PDF, so it anchors the method rather than
// certifying it to the arcsecond. Radius lands within 0.3'. The dial position
// lands within ~2.4 deg, which is ~1.6' of alignment error at Polaris' radius.
// Not yet chased down: most likely the screenshot was taken a few minutes off
// the quoted timestamp (2.4 deg is 9.5 minutes of clock), or iOptron apply a
// refraction correction we do not. Cross-check against Stellarium before
// tightening these bounds.

test('iOptron published vector: Polaris radius', () => {
  const r = polarisReticle(
    new Date('2016-08-10T21:50:18Z'),         // 17:50:18 EDT
    42 + 30 / 60 + 28 / 3600,
    -(71 + 8 / 60 + 49 / 3600),
  );
  assert.ok(Math.abs(r.radiusArcmin - 40.2) < 0.5,
    `radius ${r.radiusArcmin.toFixed(2)}' vs published 40.2'`);
});

test('iOptron published vector: dial position', () => {
  const r = polarisReticle(
    new Date('2016-08-10T21:50:18Z'),
    42 + 30 / 60 + 28 / 3600,
    -(71 + 8 / 60 + 49 / 3600),
  );
  const publishedDial = 18.4 / 60;
  let err = Math.abs(r.dialDecimal - publishedDial);
  err = Math.min(err, 12 - err) * 30;                    // dial-hours -> degrees
  assert.ok(err < 3,
    `dial ${r.dialHour}h ${r.dialMinute.toFixed(1)}m vs published 0h 18.4m ` +
    `(${err.toFixed(2)} deg apart)`);
});

test('dial hours are 30 degrees each, not 15', () => {
  // Guards the factor-of-two trap: a 12-hour dial spanning a full circle.
  const base = new Date('2026-09-19T04:00:00Z');
  const a = polarisReticle(base, 42.5, -71.1);
  // Two sidereal hours later the position angle must move 2 * 15 = 30 deg,
  // which is exactly ONE dial hour.
  const later = new Date(base.getTime() + 2 * 3600 * 1000 * 0.9972696);
  const b = polarisReticle(later, 42.5, -71.1);
  let d = ((a.dialDecimal - b.dialDecimal) % 12 + 12) % 12;
  assert.ok(Math.abs(d - 1) < 0.02, `moved ${d.toFixed(3)} dial-hours, expected 1`);
});

// A chart that is rotated or mirrored still looks like a star chart, so the
// orientation gets its own test rather than relying on it looking right.
test('chart orientation: up is the zenith, west is on the left', () => {
  const lst = 6;                       // hours; put the meridian wherever
  const at = (raDeg) => projectAroundPole(raDeg, 60, lst, 50);

  // Hour angle 0 = upper culmination = directly ABOVE the pole = top of chart.
  const top = at(lst * 15);
  assert.ok(Math.abs(top.x) < 1e-9, `HA=0 should be centred, x=${top.x}`);
  assert.ok(top.y < 0, `HA=0 should be at the top (negative y), got ${top.y}`);

  // Hour angle 12h = lower culmination = below the pole, toward the horizon.
  const bottom = at(lst * 15 - 180);
  assert.ok(bottom.y > 0, `HA=12h should be at the bottom, got ${bottom.y}`);

  // Hour angle 6h: the star has moved west, which is LEFT when facing north.
  const west = at(lst * 15 - 90);
  assert.ok(west.x < 0, `HA=6h should be on the left (west), got ${west.x}`);

  // And east is on the right.
  const east = at(lst * 15 + 90);
  assert.ok(east.x > 0, `HA=-6h should be on the right (east), got ${east.x}`);
});

test('chart drops stars outside the field and scales to the edge', () => {
  assert.equal(projectAroundPole(0, 20, 0, 50), null, 'dec 20 is 70 deg out');
  const edge = projectAroundPole(0, 40, 0, 50);   // exactly 50 deg from pole
  assert.ok(Math.abs(Math.hypot(edge.x, edge.y) - 1) < 1e-9);
});

test('Polaris stays within ~1 degree of the pole all night', () => {
  const lat = 42.5;
  for (let h = 0; h < 24; h += 3) {
    const d = new Date(Date.UTC(2026, 8, 19, h));
    const { ra, dec } = polarisReticle(d, lat, -71.1);
    const { alt } = equatorialToHorizontal(ra, dec, lstHours(julianDay(d), -71.1), lat);
    assert.ok(Math.abs(alt - lat) < 1.0, `alt ${alt} vs lat ${lat} at ${h}h`);
  }
});
