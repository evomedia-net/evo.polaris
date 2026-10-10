// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { moonPhase, moonPhaseWords } from '../site/src/moon.js';

// THE MOON SAYS WHICH PHASE IT IS IN (#264).
//
// Kelly, with a screenshot of the ring round an all-but-unlit disc labelled
// "Moon": "'missing' moon should label all stages it goes through, but for
// sure 'dark side' as it looks like moon is missing".

const appJs = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

test('new moon says the dark side is facing us', () => {
  assert.equal(moonPhaseWords({ illuminated: 0.004, name: 'New Moon' }), 'new, dark side facing us');
});

test('every other stage is named, with how much is lit', () => {
  const cases = [
    [{ illuminated: 0.12, name: 'Waxing Crescent' }, 'waxing crescent, 12% lit'],
    [{ illuminated: 0.5, name: 'First Quarter' }, 'first quarter, 50% lit'],
    [{ illuminated: 0.81, name: 'Waxing Gibbous' }, 'waxing gibbous, 81% lit'],
    [{ illuminated: 0.995, name: 'Full Moon' }, 'full, 100% lit'],
    [{ illuminated: 0.7, name: 'Waning Gibbous' }, 'waning gibbous, 70% lit'],
    [{ illuminated: 0.49, name: 'Last Quarter' }, 'last quarter, 49% lit'],
    [{ illuminated: 0.08, name: 'Waning Crescent' }, 'waning crescent, 8% lit'],
  ];
  for (const [phase, words] of cases) assert.equal(moonPhaseWords(phase), words);
});

test('a whole month goes through all eight stages', () => {
  const seen = new Set();
  const start = Date.UTC(2026, 9, 1);
  for (let h = 0; h < 30 * 24; h += 3) {
    const words = moonPhaseWords(moonPhase(new Date(start + h * 3600e3)));
    seen.add(words.split(',')[0]);
  }
  for (const stage of ['new', 'waxing crescent', 'first quarter', 'waxing gibbous',
    'full', 'waning gibbous', 'last quarter', 'waning crescent']) {
    assert.ok(seen.has(stage), `${stage} never came up`);
  }
});

test('the ring label, the caption and the spoken words all carry it', () => {
  assert.match(appJs, /name: 'Moon', phase: skyMoonWords/, 'the Moon target carries its phase');
  assert.match(appJs, /skyMoonWords = moonPhaseWords\(ph\);/, 'worked out with the sky');
  const label = appJs.slice(appJs.indexOf('function targetLabel('), appJs.indexOf('function targetIsPainted('));
  assert.match(label, /t\.phase/, 'the map label');
  assert.ok((appJs.match(/ringOn\.phase \? ` \(\$\{ringOn\.phase\}\)` : ''/g) || []).length >= 3,
    'the spoken words and both below-the-horizon captions');
});
