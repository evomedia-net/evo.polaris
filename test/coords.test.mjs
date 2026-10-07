// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveCoordinate, hemisphereFor, validate, formPosition } from '../site/src/coords.js';

test('the button supplies the sign, so no minus has to be typed', () => {
  // The whole point: 33.8688 with S selected is Sydney, not Lebanon.
  assert.deepEqual(resolveCoordinate('33.8688', 'S', 'S'),
    { ok: true, value: -33.8688, hemi: 'S', magnitude: 33.8688 });
  assert.deepEqual(resolveCoordinate('42.5078', 'N', 'S'),
    { ok: true, value: 42.5078, hemi: 'N', magnitude: 42.5078 });
  assert.deepEqual(resolveCoordinate('95.2107', 'W', 'W'),
    { ok: true, value: -95.2107, hemi: 'W', magnitude: 95.2107 });
  assert.deepEqual(resolveCoordinate('151.2093', 'E', 'W'),
    { ok: true, value: 151.2093, hemi: 'E', magnitude: 151.2093 });
});

test('a typed minus sign beats the button and moves it', () => {
  // Someone pastes "-33.8688" while N is selected. Letting the button win
  // would silently produce a northern answer -- the exact bug these buttons
  // exist to remove -- so the explicit sign wins and the button follows.
  const r = resolveCoordinate('-33.8688', 'N', 'S');
  assert.equal(r.value, -33.8688);
  assert.equal(r.hemi, 'S', 'the button must move to match what was typed');
  assert.equal(r.magnitude, 33.8688, 'and the field normalises to a magnitude');
});

test('the two can never end up disagreeing on screen', () => {
  // Whatever goes in, the returned hemi and the sign of the returned value
  // always agree. That invariant is what stops the screen contradicting itself.
  for (const raw of ['-180', '-71.1469', '-0.5', '0', '0.5', '71.1469', '180']) {
    for (const hemi of ['E', 'W']) {
      const r = resolveCoordinate(raw, hemi, 'W');
      const impliedByValue = r.value < 0 ? 'W' : 'E';
      if (r.value !== 0) {
        assert.equal(r.hemi, impliedByValue,
          `raw=${raw} hemi=${hemi} -> value ${r.value} but button ${r.hemi}`);
      }
    }
  }
});

test('zero is not dragged into a hemisphere it did not ask for', () => {
  // The equator and the prime meridian are real places. Zero keeps whichever
  // button is selected rather than being forced positive.
  assert.equal(resolveCoordinate('0', 'S', 'S').value, -0);
  assert.equal(resolveCoordinate('0', 'N', 'S').value, 0);
  assert.equal(resolveCoordinate('0', 'S', 'S').hemi, 'S');
});

test('rubbish is rejected rather than silently becoming a number', () => {
  for (const raw of ['', '   ', 'abc', 'N', '--5', undefined, null]) {
    assert.equal(resolveCoordinate(raw, 'N', 'S').ok, false, `raw=${JSON.stringify(raw)}`);
  }
  // But whitespace round a real number is fine -- people paste.
  assert.equal(resolveCoordinate('  42.5  ', 'N', 'S').value, 42.5);
});

test('a saved signed position maps back onto the right button', () => {
  assert.equal(hemisphereFor(-33.8688, 'N', 'S'), 'S');
  assert.equal(hemisphereFor(42.5078, 'N', 'S'), 'N');
  assert.equal(hemisphereFor(-95.2107, 'E', 'W'), 'W');
  assert.equal(hemisphereFor(151.2093, 'E', 'W'), 'E');
  assert.equal(hemisphereFor(0, 'N', 'S'), 'N');
});

test('ranges are enforced on the signed value, not the magnitude', () => {
  assert.equal(validate(-90, 90), true);
  assert.equal(validate(90, 90), true);
  assert.equal(validate(-90.1, 90), false);
  assert.equal(validate(180, 180), true);
  assert.equal(validate(-180.5, 180), false);
  assert.equal(validate(NaN, 90), false);
});

test('the round trip holds for every place the app has been tested at', () => {
  const sites = [
    ['Boston', 42.5078, -71.1469],
    ['Sydney', -33.8688, 151.2093],
    ['Kingwood', 30.0563, -95.2107],
    ['Greenwich', 51.4779, -0.0015],
    ['Quito', -0.1807, -78.4678],
  ];
  for (const [name, lat, lon] of sites) {
    const latHemi = hemisphereFor(lat, 'N', 'S');
    const lonHemi = hemisphereFor(lon, 'E', 'W');
    // Feed back the magnitude and the button, as the form does.
    assert.equal(resolveCoordinate(Math.abs(lat), latHemi, 'S').value, lat, `${name} lat`);
    assert.equal(resolveCoordinate(Math.abs(lon), lonHemi, 'W').value, lon, `${name} lon`);
  }
});

// THE ALTITUDE LOOKUP READ THE BOXES WITHOUT THE BUTTONS (#183).
//
// "If I click look up altitude, it sets it to 5052" -- for a saved position
// of 32.7975 North, 94.6077 West at 86 m. The lookup parsed the two boxes and
// sent them to the elevation service as they were, and a box holds only the
// size of a coordinate: 94.6077 West went out as 94.6077 East, which is the
// Tibetan Plateau. Apply was always right, because it signs through
// resolveCoordinate; the lookup now goes through the same door.

test('the form describes a signed position, with the sign from the buttons', () => {
  assert.deepEqual(formPosition('32.7975', 'N', '94.6077', 'W'),
    { ok: true, lat: 32.7975, lon: -94.6077 }, 'East Texas, not Tibet');
  assert.deepEqual(formPosition('33.8688', 'S', '151.2093', 'E'),
    { ok: true, lat: -33.8688, lon: 151.2093 }, 'Sydney');
  assert.deepEqual(formPosition('-0.1807', 'N', '-78.4678', 'E'),
    { ok: true, lat: -0.1807, lon: -78.4678 }, 'a typed minus still wins');
  assert.equal(formPosition('', 'N', '94.6', 'W').ok, false, 'a blank box is not a position');
  assert.equal(formPosition('91', 'N', '94.6', 'W').ok, false, 'latitude past the pole');
  assert.equal(formPosition('32.8', 'N', '181', 'W').ok, false, 'longitude past the date line');
});

test('the altitude lookup asks about that signed position, not the bare boxes', () => {
  const app = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
  const start = app.indexOf("$('lookupAlt').onclick");
  assert.ok(start > 0, 'the lookup handler is gone');
  const handler = app.slice(start, app.indexOf('\n};', start));
  assert.match(handler, /formPosition\(\$\('inLat'\)\.value, latHemi, \$\('inLon'\)\.value, lonHemi\)/,
    'the lookup must sign the boxes with the buttons');
  assert.ok(!/parseFloat\(\$\('in(Lat|Lon)'\)/.test(handler),
    'reading a box on its own drops its hemisphere');
  assert.match(handler, /latitude=\$\{encodeURIComponent\(lat\)\}&longitude=\$\{encodeURIComponent\(lon\)\}/);
});
