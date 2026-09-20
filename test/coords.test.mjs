import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCoordinate, hemisphereFor, validate } from '../site/src/coords.js';

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
