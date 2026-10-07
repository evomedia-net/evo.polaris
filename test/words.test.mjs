// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spellInteger, spellDecimal, spellAngle } from '../site/src/words.js';
import { toDM } from '../site/src/astro.js';

test('whole numbers spell correctly across the joins', () => {
  const cases = [
    [0, 'zero'], [7, 'seven'], [13, 'thirteen'], [19, 'nineteen'],
    [20, 'twenty'], [21, 'twenty-one'], [42, 'forty-two'], [50, 'fifty'],
    [66, 'sixty-six'], [90, 'ninety'], [99, 'ninety-nine'],
    [100, 'one hundred'], [101, 'one hundred and one'],
    [151, 'one hundred and fifty-one'], [180, 'one hundred and eighty'],
  ];
  for (const [n, want] of cases) {
    assert.equal(spellInteger(n), want, `${n}`);
  }
});

test('decimals keep one place and say "point"', () => {
  assert.equal(spellDecimal(30.5), 'thirty point five');
  assert.equal(spellDecimal(8.0), 'eight');
  assert.equal(spellDecimal(0.4), 'zero point four');
  assert.equal(spellDecimal(59.94), 'fifty-nine point nine');
});

test('a latitude reads the way you would say it', () => {
  assert.equal(spellAngle(toDM(42.5078, 'N', 'S')),
    'forty-two degrees, thirty point five minutes north');
  assert.equal(spellAngle(toDM(-33.8688, 'N', 'S')),
    'thirty-three degrees, fifty-two point one minutes south');
  assert.equal(spellAngle(toDM(-71.1469, 'E', 'W')),
    'seventy-one degrees, eight point eight minutes west');
});

test('an exact degree does not say "zero minutes"', () => {
  assert.equal(spellAngle(toDM(45, 'N', 'S')), 'forty-five degrees north');
});

test('one minute is singular', () => {
  // 42 deg 1.0' -- the plural would be a small wrongness read aloud every time.
  assert.equal(spellAngle(toDM(42 + 1 / 60, 'N', 'S')),
    'forty-two degrees, one minute north');
});

test('minutes carry into degrees rather than printing 60', () => {
  // 42.9995 deg is 42 59.97', which must round to 43 00.0' and not 42 60.0'.
  const dm = toDM(42.9995, 'N', 'S');
  assert.equal(dm.deg, 43);
  assert.equal(Math.round(dm.min * 10), 0);
  assert.equal(spellAngle(dm), 'forty-three degrees north');
});

test('the altitude axis carries no hemisphere letter', () => {
  // The mount's wedge scale is an UNSIGNED angle. It was derived from
  // Math.abs(latitude) and then labelled with the positive hemisphere, which
  // printed "33 52.1' N" for Sydney -- a southern latitude labelled north,
  // on the one number that ruins the whole night if it is set wrong.
  const noHemi = toDM(Math.abs(-33.8688), '', '');
  assert.equal(noHemi.text, "33° 52.1'");
  assert.equal(noHemi.hemi, '');
  assert.equal(spellAngle(noHemi),
    'thirty-three degrees, fifty-two point one minutes');

  // The separate latitude row keeps its letter, and keeps the right one.
  assert.equal(toDM(-33.8688, 'N', 'S').text, "33° 52.1' S");
  assert.equal(toDM(42.5078, 'N', 'S').text, "42° 30.5' N");
});
