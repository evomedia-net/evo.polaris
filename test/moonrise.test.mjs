import test from 'node:test';
import assert from 'node:assert/strict';
import { moonRiseSet, describeMoonTimes, moonPosition } from '../site/src/moon.js';
import { julianDay, lstHours, equatorialToHorizontal } from '../site/src/astro.js';

// Moonrise is the one time in this app that is easy to get wrong by several
// minutes while looking completely right, because the altitude it happens at
// is neither zero nor the Sun's -0.8333: the Moon is close enough that
// PARALLAX dominates, and it sits about a degree LOWER seen from the ground
// than from the centre of the Earth.

const HOUSTON = [30.0563, -95.2107];

const altAt = (t, lat, lon) => {
  const m = moonPosition(t);
  return equatorialToHorizontal(m.ra, m.dec, lstHours(julianDay(t), lon), lat).alt;
};

test('the Moon is at the rise altitude at the moment it rises, and at sunset-of-itself when it sets', () => {
  const { rise, set } = moonRiseSet(new Date('2026-11-20T12:00'), ...HOUSTON);
  for (const [name, t] of [['rise', rise], ['set', set]]) {
    assert.ok(t, `expected a ${name}`);
    // 0.125 deg: Meeus's 0.7275*parallax - 0.5667. Zero or -0.8333 would each
    // land several minutes out, in the same direction every time.
    assert.ok(Math.abs(altAt(t, ...HOUSTON) - 0.125) < 0.01,
      `${name} altitude ${altAt(t, ...HOUSTON)} should be 0.125`);
  }
});

test('it is genuinely up between rising and setting, and down between setting and rising', () => {
  const { rise, set } = moonRiseSet(new Date('2026-11-20T12:00'), ...HOUSTON);
  // On this day it sets in the morning and rises in the afternoon, so the gap
  // BETWEEN them is the down time -- the order is not assumed either way.
  const [first, second] = +set < +rise ? [set, rise] : [rise, set];
  const middle = new Date((+first + +second) / 2);
  const inGapIsDown = +set < +rise;
  const alt = altAt(middle, ...HOUSTON);
  assert.ok(inGapIsDown ? alt < -1 : alt > 1,
    `midway altitude ${alt.toFixed(2)} contradicts the rise/set order`);
});

test('the times come out in the order they happen', () => {
  // Within one calendar day the Moon usually SETS first, having risen the
  // previous afternoon. Listing rise first printed "rises 3:52 PM, sets 1:13
  // AM", which reads as a set nine hours before the rise it follows.
  const r = moonRiseSet(new Date('2026-09-20T12:00'), ...HOUSTON);
  const text = describeMoonTimes(r);
  if (r.rise && r.set) {
    const riseFirst = +r.rise < +r.set;
    assert.equal(text.indexOf('rises') < text.indexOf('sets'), riseFirst,
      `wrong order: ${text}`);
  }
});

test('a day with no moonrise is reported as one, not invented', () => {
  // The Moon rises about 50 minutes later each day, so roughly once a month a
  // calendar day contains no moonrise at all. Over two months there must be
  // at least one, and every one of them must still produce a sentence.
  let missingRise = 0, missingSet = 0;
  for (let i = 0; i < 60; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i, 12));
    const r = moonRiseSet(day, ...HOUSTON);
    if (!r.rise) missingRise++;
    if (!r.set) missingSet++;
    assert.ok(describeMoonTimes(r).length > 10, 'every day gets a sentence');
  }
  assert.ok(missingRise >= 1, `expected a day with no moonrise, got ${missingRise}`);
  assert.ok(missingSet >= 1, `expected a day with no moonset, got ${missingSet}`);
});

test('rising drifts about fifty minutes later each day', () => {
  // The synodic drift. It is what makes the Moon a different object every
  // night, and it falls out of the orbit rather than being coded anywhere.
  const times = [];
  for (let i = 0; i < 12; i++) {
    const r = moonRiseSet(new Date(Date.UTC(2026, 2, 1 + i, 12)), ...HOUSTON);
    if (r.rise) times.push(+r.rise);
  }
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 60000)
    .filter((m) => m > 0 && m < 36 * 60);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(mean > 24 * 60 + 30 && mean < 24 * 60 + 70,
    `mean gap ${mean.toFixed(0)} min, expected about ${24 * 60 + 50}`);
});

test('inside the arctic circle it can do neither, and says which side', () => {
  let up = 0, down = 0;
  for (let i = 0; i < 30; i++) {
    const r = moonRiseSet(new Date(Date.UTC(2026, 0, 1 + i, 12)), 78, 15);
    if (!r.rise && !r.set) {
      const text = describeMoonTimes(r);
      if (r.alwaysUp) { up++; assert.match(text, /above the horizon all day/); }
      else { down++; assert.match(text, /below the horizon all day/); }
    }
  }
  assert.ok(up + down > 0, 'at 78N some days should have neither');
  assert.ok(up > 0 && down > 0,
    `expected both all-day-up and all-day-down at 78N, got up=${up} down=${down}`);
});

test('the times are absolute instants, so they render in the reader clock', () => {
  const { rise } = moonRiseSet(new Date('2026-11-20T12:00'), ...HOUSTON);
  assert.ok(rise instanceof Date && !Number.isNaN(+rise));
  // A Date is UTC underneath; only the formatting is local. That is what
  // makes one computation correct in every time zone.
  assert.match(rise.toISOString(), /^\d{4}-\d{2}-\d{2}T/);
});

test('a time is never shown without saying how rough it is', () => {
  // Honest reporting, made enforceable. A time printed to the minute reads as
  // accurate to the minute; this one is worth a few either way, and the number
  // and its caveat must not be separable.
  const days = [
    new Date('2026-09-20T12:00'), new Date('2026-11-20T12:00'),
    new Date('2026-03-05T12:00'),
  ];
  for (const d of days) {
    const r = moonRiseSet(d, ...HOUSTON);
    const text = describeMoonTimes(r);
    if (r.rise || r.set) {
      assert.match(text, /± a few minutes/, `no accuracy caveat: ${text}`);
    }
  }
  // And it attaches to the times rather than trailing the paragraph: on a day
  // with only one of the two, the tolerance must come BEFORE the sentence
  // explaining the other.
  const oneOnly = moonRiseSet(new Date(Date.UTC(2026, 0, 9, 12)), ...HOUSTON);
  if ((oneOnly.rise ? 1 : 0) + (oneOnly.set ? 1 : 0) === 1) {
    const t = describeMoonTimes(oneOnly);
    assert.ok(t.indexOf('±') < t.indexOf('It does not'),
      `the tolerance should attach to the time, not trail the paragraph: ${t}`);
  }

  // And the polar days, which quote no time, do not need one.
  const polar = moonRiseSet(new Date(Date.UTC(2026, 0, 15, 12)), 78, 15);
  if (!polar.rise && !polar.set) {
    assert.ok(!/±/.test(describeMoonTimes(polar)),
      'a sentence with no time in it should not carry a tolerance');
  }
});
