// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moonPosition, moonPhase, sunEclipticLongitude, describeMoon,
} from '../site/src/moon.js';
import { equatorialToHorizontal, lstHours, julianDay } from '../site/src/astro.js';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

// --- checked against published lunar events ---------------------------------
//
// Phase is the half of this worth pinning hardest: it decides whether a night
// is worth setting up for, and unlike position it can be checked against dates
// anyone can look up.

test('the reference lunation comes out new and full on time', () => {
  // Only dates I can actually vouch for: the new Moon of 2000 January 6 at
  // 18:14 UT is the standard epoch quoted in the lunation tables, and the full
  // Moon a fortnight later follows from it. Four other 2026 dates were in this
  // list first and were wrong -- written from memory and labelled "published",
  // which is the one thing a reference value must never be.
  const events = [
    ['2000-01-06T18:14:00Z', 'new'],
    ['2000-01-21T04:40:00Z', 'full'],
  ];
  for (const [iso, kind] of events) {
    const p = moonPhase(new Date(iso));
    if (kind === 'new') {
      assert.ok(p.illuminated < 0.02,
        `${iso} should be new, got ${(p.illuminated * 100).toFixed(1)}% lit`);
    } else {
      assert.ok(p.illuminated > 0.98,
        `${iso} should be full, got ${(p.illuminated * 100).toFixed(1)}% lit`);
    }
  }
});

test('the quarters are half lit, and know which quarter they are', () => {
  // A first quarter is waxing; a last quarter is waning. Getting that backwards
  // is a wrong answer that still reads as a plausible one.
  const first = moonPhase(new Date('2000-01-14T13:34:00Z'));
  near(first.illuminated, 0.5, 0.05, 'first quarter illumination');
  assert.equal(first.waxing, true, 'first quarter must be waxing');

  const last = moonPhase(new Date('2000-01-28T07:57:00Z'));
  near(last.illuminated, 0.5, 0.05, 'last quarter illumination');
  assert.equal(last.waxing, false, 'last quarter must be waning');
});

test('the cycle repeats on the synodic month, not the sidereal one', () => {
  // 29.53 days, not 27.32 -- confusing the two is a classic error that drifts
  // two days per month and looks fine for about a fortnight.
  const t0 = new Date('2026-03-03T00:00:00Z');
  const a = moonPhase(t0);
  const later = new Date(t0.getTime() + 29.530588853 * 86400000);
  const b = moonPhase(later);
  near(b.illuminated, a.illuminated, 0.02, 'illumination after one synodic month');

  const sidereal = new Date(t0.getTime() + 27.321661 * 86400000);
  assert.ok(Math.abs(moonPhase(sidereal).illuminated - a.illuminated) > 0.05,
    'a sidereal month must NOT return the same phase');
});

test('illumination stays in range and passes through every value', () => {
  let min = 1, max = 0;
  for (let i = 0; i < 400; i++) {
    const p = moonPhase(new Date(Date.UTC(2026, 0, 1) + i * 0.1 * 86400000));
    assert.ok(p.illuminated >= 0 && p.illuminated <= 1,
      `out of range: ${p.illuminated}`);
    min = Math.min(min, p.illuminated);
    max = Math.max(max, p.illuminated);
  }
  assert.ok(min < 0.02, `should reach new, lowest was ${min}`);
  assert.ok(max > 0.98, `should reach full, highest was ${max}`);
});

// --- position ---------------------------------------------------------------

test('the Moon stays within about five degrees of the ecliptic', () => {
  // Its orbit is inclined 5.145 degrees. Anything outside that is a broken
  // latitude term, and the sky view would draw it in the wrong constellation.
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const b = Math.abs(moonPosition(
      new Date(Date.UTC(2026, 0, 1) + i * 0.5 * 86400000)).eclipticLat);
    if (b > worst) worst = b;
  }
  assert.ok(worst > 4.5 && worst < 6.0,
    `peak ecliptic latitude ${worst.toFixed(2)} deg, expected about 5.2`);
});

test('distance stays between perigee and apogee', () => {
  let min = 1e9, max = 0;
  for (let i = 0; i < 1000; i++) {
    const r = moonPosition(
      new Date(Date.UTC(2026, 0, 1) + i * 0.5 * 86400000)).distanceKm;
    min = Math.min(min, r); max = Math.max(max, r);
  }
  assert.ok(min > 355000 && min < 372000, `perigee ${min.toFixed(0)} km`);
  assert.ok(max > 398000 && max < 410000, `apogee ${max.toFixed(0)} km`);
});

test('it goes right round the sky in a sidereal month', () => {
  // Position repeats on 27.32 days -- the other period. This is the pair to
  // the phase test above, and together they pin both cycles.
  const t0 = new Date('2026-04-01T00:00:00Z');
  const a = moonPosition(t0);
  const b = moonPosition(new Date(t0.getTime() + 27.321661 * 86400000));
  // Back where it started, so the signed difference is ~0. Normalising to
  // +/-180 and then asserting 180 is the same mistake I made in signedTurn:
  // "no change" reads as zero, not as half a turn.
  const d = ((b.eclipticLon - a.eclipticLon + 540) % 360) - 180;
  near(d, 0, 3, 'ecliptic longitude after one sidereal month');
});

test('declination never leaves the range the tilted orbit allows', () => {
  // Obliquity plus orbital inclination, so about 28.7 degrees at the extreme.
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const dec = Math.abs(moonPosition(
      new Date(Date.UTC(2026, 0, 1) + i * 0.5 * 86400000)).dec);
    if (dec > worst) worst = dec;
  }
  assert.ok(worst < 29, `peak declination ${worst.toFixed(2)} deg`);
  assert.ok(worst > 17, `should get well north, peak was ${worst.toFixed(2)}`);
});

test('the position converts into the sky like any other object', () => {
  const when = new Date('2026-09-20T02:00:00Z');
  const m = moonPosition(when);
  const { alt, az } = equatorialToHorizontal(
    m.ra, m.dec, lstHours(julianDay(when), -71.1), 42.5);
  assert.ok(alt >= -90 && alt <= 90, `altitude ${alt}`);
  assert.ok(az >= 0 && az < 360, `azimuth ${az}`);
});

// --- what it tells you ------------------------------------------------------

test('a Moon below the horizon is said not to matter', () => {
  const s = describeMoon({ name: 'Full Moon', illuminated: 1 }, -20);
  assert.match(s, /below the horizon/);
  assert.match(s, /not spoil/);
});

test('a bright Moon up is called a problem, a thin one is not', () => {
  assert.match(describeMoon({ name: 'Full Moon', illuminated: 0.99 }, 40),
    /wash out/);
  assert.match(describeMoon({ name: 'Waxing Crescent', illuminated: 0.06 }, 40),
    /ignore/);
});

test('the Sun ecliptic longitude runs once round the year', () => {
  const a = sunEclipticLongitude(new Date('2026-01-01T00:00:00Z'));
  const b = sunEclipticLongitude(new Date('2026-07-02T00:00:00Z'));
  const d = ((b - a) % 360 + 360) % 360;
  near(d, 180, 3, 'half a year is half a circuit');
});

test('successive new Moons are one synodic month apart', () => {
  // Independent of any quoted date: find the new Moons by search and check
  // their spacing. If the periodic terms were wrong this drifts immediately.
  const newMoons = [];
  let prev = moonPhase(new Date(Date.UTC(2026, 0, 1))).elongation;
  for (let i = 1; i < 3000; i++) {
    const t = new Date(Date.UTC(2026, 0, 1) + i * 0.05 * 86400000);
    const e = moonPhase(t).elongation;
    if (e < prev) newMoons.push(t);          // elongation wrapped past 360
    prev = e;
  }
  assert.ok(newMoons.length >= 4, `found ${newMoons.length} new Moons`);
  for (let i = 1; i < newMoons.length; i++) {
    const days = (newMoons[i] - newMoons[i - 1]) / 86400000;
    assert.ok(Math.abs(days - 29.53) < 1.0,
      `lunation ${i} lasted ${days.toFixed(2)} days, expected about 29.53`);
  }
});
