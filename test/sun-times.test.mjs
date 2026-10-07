// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  sunRiseSet, sunNow, riseSetOnDay, SUNRISE_ALT,
  sunPosition, equatorialToHorizontal, lstHours, julianDay,
} from '../site/src/astro.js';

// SUNRISE AND SUNSET, UNDER THE COORDINATES.
//
// "Directly below the latitude longitude numbers add: Sunrise {HH:MM} /
// Sunset {HH:MM}."
//
// The times are checked against the definition rather than against a table,
// on purpose: a table of times is a table for one place in one time zone, and
// this runs wherever the tests run. What is asserted instead is the property
// that makes a time a sunrise -- the Sun is exactly at the horizon then, below
// a minute before and above a minute after.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
const css = readFileSync(
  fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');
const moonJs = readFileSync(
  fileURLToPath(new URL('../site/src/moon.js', import.meta.url)), 'utf8');

/** The Sun's altitude in degrees, from one place at one instant. */
function sunAltAt(t, lat, lon) {
  const { ra, dec } = sunPosition(t);
  return equatorialToHorizontal(ra, dec, lstHours(julianDay(t), lon), lat).alt;
}

const PLACES = [
  ['Houston', 30.06, -95.21],
  ['Greenwich', 51.48, 0],
  ['Sydney', -33.87, 151.21],
  ['Quito', -0.18, -78.47],
];

test('at the time it calls sunrise, the Sun is on the horizon', () => {
  // The whole definition, checked directly. Anything that merely LOOKS like a
  // plausible clock time passes a table check; only this catches a solver that
  // is bisecting the wrong crossing.
  let checked = 0;
  for (const [name, lat, lon] of PLACES) {
    for (const month of [0, 3, 6, 9]) {
      const { rise, set } = sunRiseSet(new Date(Date.UTC(2026, month, 15, 12)), lat, lon);
      for (const [what, when] of [['rise', rise], ['set', set]]) {
        if (!when) continue;
        assert.ok(Math.abs(sunAltAt(when, lat, lon) - SUNRISE_ALT) < 0.02,
          `${name} ${what}: alt ${sunAltAt(when, lat, lon).toFixed(3)} is not the horizon`);
        // And it is a crossing, in the right direction.
        const before = sunAltAt(new Date(+when - 120000), lat, lon);
        const after = sunAltAt(new Date(+when + 120000), lat, lon);
        if (what === 'rise') assert.ok(before < after, `${name} rise must be climbing`);
        else assert.ok(before > after, `${name} set must be falling`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 24, `only checked ${checked} crossings`);
});

test('the polar day and the polar night say which, rather than inventing a time', () => {
  // Longyearbyen: the Sun does not set in June and does not rise in December.
  const june = sunRiseSet(new Date(Date.UTC(2026, 5, 21, 12)), 78.22, 15.63);
  assert.equal(june.rise, null);
  assert.equal(june.set, null);
  assert.equal(june.alwaysUp, true, 'up all day');
  const dec = sunRiseSet(new Date(Date.UTC(2026, 11, 21, 12)), 78.22, 15.63);
  assert.equal(dec.rise, null);
  assert.equal(dec.set, null);
  assert.equal(dec.alwaysUp, false, 'down all day — the opposite piece of news');
});

test('the horizon is the disc and the air, not zero, and one number says so', () => {
  // Refraction lifts the Sun about 34 arcminutes and the disc is about 32
  // across, so the centre is 50 arcminutes down when the upper limb touches.
  assert.equal(SUNRISE_ALT, -0.833);
  // And sunNow's "up" reads the same constant. Two copies would let the
  // readout call the Sun up while the line under the coordinates says it set.
  const astro = readFileSync(
    fileURLToPath(new URL('../site/src/astro.js', import.meta.url)), 'utf8');
  const fn = astro.slice(astro.indexOf('export function sunNow('),
    astro.indexOf('\n}', astro.indexOf('export function sunNow(')));
  assert.match(fn, /up: alt > SUNRISE_ALT/);
  assert.doesNotMatch(fn, /-0\.833/, 'no second copy of the threshold');
  const noon = sunNow(new Date(Date.UTC(2026, 5, 21, 17)), 30.06, -95.21);
  assert.ok(noon.up && noon.alt > 70, `midday Sun should be high, got ${noon.alt}`);
});

test('the Sun and the Moon share one solver', () => {
  // Two copies of a bisection are two chances to get the bracket wrong, and
  // only one of them would ever be noticed.
  assert.match(moonJs, /riseSetOnDay/, 'the Moon must use it too');
  assert.match(moonJs, /import \{[^}]*riseSetOnDay[^}]*\} from '\.\/astro\.js';/);
  assert.ok(!/function refine\(/.test(moonJs), 'the Moon must not keep its own bisection');
  // It takes the caller's ephemeris and the caller's horizon, which is the
  // only reason one function can serve two bodies: the Moon's threshold is
  // POSITIVE, because parallax beats refraction for something that close.
  const flat = riseSetOnDay(() => 5, new Date(Date.UTC(2026, 5, 21, 12)), 0);
  assert.equal(flat.rise, null);
  assert.equal(flat.alwaysUp, true, 'never crossing and always above is "up all day"');
  const under = riseSetOnDay(() => -5, new Date(Date.UTC(2026, 5, 21, 12)), 0);
  assert.equal(under.alwaysUp, false);
});

// --- the line itself ------------------------------------------------------------------

test('the line sits directly under the coordinates', () => {
  const bar = html.slice(html.indexOf('<div class="place" id="placeBar"'),
    html.indexOf('</div>', html.indexOf('id="placeChange"')));
  assert.ok(bar.includes('id="placeSun"'));
  assert.ok(bar.indexOf('id="placeWhere"') < bar.indexOf('id="placeSun"'),
    'directly below the latitude and longitude, not above them');
  assert.match(css, /\.place-sun \{/);
});

test('the two times are separated by a slash', () => {
  const fn = appJs.slice(appJs.indexOf('function sunLine()'),
    appJs.indexOf('function showSunLine('));
  assert.match(fn, /`Sunrise \$\{clock\(rise\)\}`/);
  assert.match(fn, /`Sunset \$\{clock\(set\)\}`/);
  assert.match(fn, /\.join\(' \/ '\)/, 'Kelly: "Use / as the separator"');
  assert.match(fn, /hour: '2-digit', minute: '2-digit'/, 'HH:MM, in the reader\'s own clock');
});

test('it answers for the night being shown, not for today', () => {
  const fn = appJs.slice(appJs.indexOf('function sunLine()'),
    appJs.indexOf('function showSunLine('));
  assert.match(fn, /sunRiseSet\(appTime\(\), site\.lat, site\.lon\)/,
    'appTime, so a planned night gets its own times');
  // And it is repainted when either of those two things changes.
  const when = appJs.slice(appJs.indexOf('function paintWhen()'),
    appJs.indexOf('\n}', appJs.indexOf('function paintWhen()')));
  assert.match(when, /showSunLine\(\);/);
  const site = appJs.slice(appJs.indexOf('function setSite('),
    appJs.indexOf('\n}', appJs.indexOf('function setSite(')));
  assert.match(site, /showSunLine\(\);/);
});

test('a day with no sunrise says so instead of printing nothing', () => {
  const fn = appJs.slice(appJs.indexOf('function sunLine()'),
    appJs.indexOf('function showSunLine('));
  assert.match(fn, /alwaysUp \? 'Sun up all day' : 'Sun down all day'/);
  assert.match(fn, /'No sunrise today'/);
  assert.match(fn, /'No sunset today'/);
  // And with nothing to say at all -- no location yet -- the line goes away
  // rather than sitting there empty under the coordinates.
  assert.match(fn, /if \(!site\) return '';/);
  const show = appJs.slice(appJs.indexOf('function showSunLine('),
    appJs.indexOf('function setSite('));
  assert.match(show, /el\.hidden = !text;/);
});
