// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  julianDay, gmstHours, lstHours, precessFromJ2000, equatorialToHorizontal,
  polarisReticle, poleStarReticle, poleStarFor, alignmentSolution, POLARIS,
  refraction, projectAroundPole, sunPosition, solarNoon, sunNow,
} from '../site/src/astro.js';

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

// --- the Sun, used to find true north without any instrument ---------------

test('solar declination tracks the seasons', () => {
  const dec = (iso) => sunPosition(new Date(iso)).dec;
  assert.ok(Math.abs(dec('2026-06-21T12:00:00Z') - 23.44) < 0.2, 'June solstice');
  assert.ok(Math.abs(dec('2026-12-21T12:00:00Z') + 23.44) < 0.2, 'Dec solstice');
  assert.ok(Math.abs(dec('2026-03-20T12:00:00Z')) < 0.6, 'March equinox');
  assert.ok(Math.abs(dec('2026-09-22T12:00:00Z')) < 0.6, 'Sept equinox');
});

test('solar noon puts the Sun on the meridian', () => {
  for (const [lat, lon] of [[42.5, -71.1], [51.5, -0.13], [-33.9, 151.2], [0, 100]]) {
    const noon = solarNoon(new Date('2026-09-19T00:00:00Z'), lon);
    const { az, alt } = sunNow(noon, lat, lon);
    // On the meridian the Sun is due south or due north, never in between.
    const offMeridian = Math.min(
      Math.abs(((az - 180 + 540) % 360) - 180),
      Math.abs(((az - 0 + 540) % 360) - 180),
    );
    assert.ok(offMeridian < 0.2,
      `lat ${lat} lon ${lon}: Sun at az ${az.toFixed(2)} at solar noon`);
    assert.ok(alt > 0, `Sun should be up at solar noon (alt ${alt.toFixed(1)})`);
  }
});

test('solar noon lands near local clock noon', () => {
  // Greenwich: solar noon must be within ~17 min of 12:00 UTC (equation of time).
  const noon = solarNoon(new Date('2026-09-19T00:00:00Z'), 0);
  const minsOff = (noon.getTime() - Date.UTC(2026, 8, 19, 12)) / 60000;
  assert.ok(Math.abs(minsOff) < 20, `solar noon ${minsOff.toFixed(1)} min from 12:00 UTC`);
});

test('a shadow falls opposite the Sun', () => {
  for (const iso of ['2026-09-19T16:00:00Z', '2026-09-19T21:00:00Z',
                     '2026-06-21T10:00:00Z']) {
    const s = sunNow(new Date(iso), 42.5, -71.1);
    // Normalised to +/-180, "exactly opposite" is 180, not 0.
    const sep = Math.abs(((s.shadowAz - s.az + 540) % 360) - 180);
    assert.ok(Math.abs(sep - 180) < 1e-9,
      `${iso}: sun ${s.az.toFixed(1)}, shadow ${s.shadowAz.toFixed(1)}`);
  }
});

// --- southern hemisphere ----------------------------------------------------

test('the pole star is chosen by the sign of the latitude', () => {
  assert.equal(poleStarFor(42.5).name, 'Polaris');
  assert.equal(poleStarFor(0).name, 'Polaris');          // equator: either works
  assert.equal(poleStarFor(-33.9).name, 'Sigma Octantis');
  assert.deepEqual(poleStarFor(42.5).rings, [36, 44]);   // engraved circles
  assert.deepEqual(poleStarFor(-33.9).rings, [60, 70]);  // differ by hemisphere
});

test('Sigma Octantis sits in the reticle ring iOptron engraves for it', () => {
  // ~63' from the pole, which is why the southern circles run 60'-70' and the
  // northern ones 36'-44'. If this drifts out of the ring the drawn scale is
  // wrong for the scope the observer is actually looking through.
  const r = poleStarReticle(new Date('2026-09-19T12:00:00Z'), -33.9, 151.2);
  assert.equal(r.hemisphere, 'south');
  assert.ok(r.radiusArcmin > 60 && r.radiusArcmin < 70,
    `Sigma Oct at ${r.radiusArcmin.toFixed(1)}' is outside the 60'-70' ring`);
});

test('the two hemispheres run their dials in opposite directions', () => {
  // This is the claim actually being made, and it is the whole southern
  // change. iOptron publish no southern worked example, so unlike the northern
  // case there is nothing external to check against.
  //
  // Note it is NOT that the two dial readings mirror each other at a given
  // instant -- they cannot, because Polaris and Sigma Octantis have completely
  // different right ascensions (about 2.9h and 21.1h), so their hour angles
  // are unrelated. What mirrors is the DIRECTION the dial travels: looking
  // north the sky turns anticlockwise about the pole, looking south it turns
  // clockwise, and the polar scope inverts both identically so the inversion
  // cancels out of the comparison.
  const lon = 151.2;
  const t0 = new Date('2026-09-19T12:00:00Z');
  const t1 = new Date(t0.getTime() + 2 * 3600 * 1000 * 0.9972696);  // 2 sidereal h

  const nMove = ((poleStarReticle(t1, 33.9, lon).dialDecimal
                - poleStarReticle(t0, 33.9, lon).dialDecimal) % 12 + 12) % 12;
  const sMove = ((poleStarReticle(t1, -33.9, lon).dialDecimal
                - poleStarReticle(t0, -33.9, lon).dialDecimal) % 12 + 12) % 12;

  // Two sidereal hours is 30 degrees, which is exactly one dial hour -- and it
  // must run backwards in the north and forwards in the south.
  assert.ok(Math.abs(nMove - 11) < 0.02,
    `north should fall one dial hour (11 mod 12), moved ${nMove.toFixed(3)}`);
  assert.ok(Math.abs(sMove - 1) < 0.02,
    `south should rise one dial hour, moved ${sMove.toFixed(3)}`);
});

test('a southern mount points at true south, not true north', () => {
  const site = { lat: -33.87, lon: 151.21, altitude: 0 };
  const sol = alignmentSolution(new Date('2026-09-19T12:00:00Z'), site, 12.5);
  assert.equal(sol.poleAzimuth, 180, 'southern pole bears 180 degrees');
  assert.equal(sol.poleName, 'true south');
  // The latitude scale is unsigned: a mount at 33.87S sets 33.87, not -33.87.
  assert.ok(Math.abs(sol.latitudeSetting - 33.87) < 1e-9,
    `latitude setting ${sol.latitudeSetting} should be positive`);
  // And the compass bearing must be about 180 off the northern answer.
  const north = alignmentSolution(
    new Date('2026-09-19T12:00:00Z'), { ...site, lat: 33.87 }, 12.5);
  const gap = Math.abs(((sol.trueNorthOnCompass - north.trueNorthOnCompass + 540) % 360) - 180);
  assert.ok(Math.abs(gap - 180) < 1e-9, `compass bearings differ by ${gap}, not 180`);
});

test('the south pole star is not filtered out of its own chart', () => {
  // Sigma Octantis is magnitude 5.47 and the northern chart's limit is 5.2.
  // Shipping that limit southward would drop the pole star silently.
  const stars = JSON.parse(
    readFileSync(new URL('../site/src/data/stars.json', import.meta.url), 'utf8'));
  const sigma = stars.find((s) => s[4] === 7228);
  assert.ok(sigma, 'Sigma Octantis (HR 7228) missing from the catalogue');
  assert.ok(sigma[2] > 5.2, `test is pointless if Sigma Oct (${sigma[2]}) is under 5.2`);
  assert.ok(sigma[2] <= 5.6, `southern chart limit of 5.6 would drop it at ${sigma[2]}`);
});

test('southern chart flips handedness: east is on the right', () => {
  // Facing north, east is on your right. Turn round to face south and east and
  // west swap over. Both charts still put upper culmination at the top.
  const lst = 6;
  const dec = -60;                                  // a southern circumpolar star
  const top = projectAroundPole(lst * 15, dec, lst, 50, true);
  assert.ok(Math.abs(top.x) < 1e-9 && top.y < 0, 'HA=0 belongs at the top');

  const west = projectAroundPole(lst * 15 - 90, dec, lst, 50, true);
  assert.ok(west.x > 0, `facing south, west should be on the RIGHT, got ${west.x}`);

  // And it is genuinely the mirror of the northern chart, not a copy.
  const northWest = projectAroundPole(lst * 15 - 90, 60, lst, 50, false);
  assert.ok(northWest.x < 0 && west.x > 0, 'the two hemispheres must mirror');
});

test('the Southern Cross 4.5x rule falls out of the projection', () => {
  // The best independent check available for the southern chart. The published
  // rule is that the Cross's long axis -- Gacrux through Acrux -- extended
  // about 4.5 times its own length lands on the south celestial pole. Nothing
  // in the code knows that number, so if the projection is wrong in scale,
  // orientation or handedness, this ratio stops coming out.
  const stars = JSON.parse(
    readFileSync(new URL('../site/src/data/stars.json', import.meta.url), 'utf8'));
  const at = (hr) => {
    const s = stars.find((x) => x[4] === hr);
    return projectAroundPole(s[0], s[1], 6, 50, true);
  };
  const gacrux = at(4763), acrux = at(4730);
  assert.ok(gacrux && acrux, 'both Crux stars must be in a 50 deg field');

  const axis = Math.hypot(acrux.x - gacrux.x, acrux.y - gacrux.y);
  const toPole = Math.hypot(acrux.x, acrux.y);          // pole is the origin
  const ratio = toPole / axis;
  assert.ok(ratio > 3.8 && ratio < 5.2,
    `Gacrux->Acrux extended ${ratio.toFixed(2)}x reaches the pole, expected ~4.5`);

  // Acrux must be the end NEARER the pole, or the arrow points into empty sky
  // in the wrong direction entirely.
  assert.ok(toPole < Math.hypot(gacrux.x, gacrux.y),
    'Acrux is the foot of the Cross and must be the end closer to the pole');
});

test('southern radius is measured from the south pole', () => {
  // dec -89 is one degree from the SOUTH pole and 179 from the north one.
  assert.equal(projectAroundPole(0, -89, 0, 50, false), null, 'not on a north chart');
  const s = projectAroundPole(0, -89, 0, 50, true);
  assert.ok(Math.hypot(s.x, s.y) - 1 / 50 < 1e-9, 'should sit 1 degree out');
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
