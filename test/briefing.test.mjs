// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenBriefing } from '../site/src/briefing.js';
import { alignmentSolution } from '../site/src/astro.js';

const WHEN = new Date('2026-09-20T02:00:00Z');
const boston = alignmentSolution(WHEN, { lat: 42.5078, lon: -71.1469, altitude: 27 }, -13.9);
const sydney = alignmentSolution(WHEN, { lat: -33.8688, lon: 151.2093, altitude: 58 }, 12.8);

test('the briefing names the right pole star for the hemisphere', () => {
  // This was a real bug: the spoken text said "Put Polaris" in both
  // hemispheres while the screen correctly said "Put sigma Oct". Someone
  // relying on the audio was sent after a star that never rises where they
  // are standing.
  assert.match(spokenBriefing(boston), /Polaris/);
  assert.doesNotMatch(spokenBriefing(boston), /Octantis/);

  assert.match(spokenBriefing(sydney), /Sigma Octantis/);
  assert.doesNotMatch(spokenBriefing(sydney), /Put Polaris/);
});

test('it says which pole the mount points at', () => {
  assert.match(spokenBriefing(boston), /true north/);
  assert.match(spokenBriefing(sydney), /true south/);
});

test('it warns that the southern pole star is faint', () => {
  // Reading "put it here" without saying it is magnitude 5.5 sets someone up
  // to hunt for a star they may well not be able to see.
  assert.match(spokenBriefing(sydney), /faint/);
  assert.match(spokenBriefing(sydney), /Southern Cross/);
  assert.doesNotMatch(spokenBriefing(boston), /faint/);
});

test('the latitude is spoken in words, not as digits', () => {
  // "42 30.5 N" is voiced very differently by different engines and some drop
  // the units entirely, which is why it is spelled out.
  assert.match(spokenBriefing(boston), /forty-two degrees, thirty point five minutes/);
  assert.match(spokenBriefing(sydney), /thirty-three degrees, fifty-two point one minutes/);
});

test('no glyphs that a speech engine will mangle or skip', () => {
  for (const s of [spokenBriefing(boston), spokenBriefing(sydney)]) {
    assert.doesNotMatch(s, /[σ°′″]/, `contains a glyph speech will mangle: ${s}`);
  }
});

test('an exact hour does not say "zero minutes"', () => {
  const fake = { ...boston, dialHour: 7, dialMinute: 0.2 };
  assert.match(spokenBriefing(fake), /7 o'clock on the dial/);
  assert.doesNotMatch(spokenBriefing(fake), /0 minutes/);
});

test('it is a string even before a position is set', () => {
  assert.equal(spokenBriefing(null), '');
  assert.equal(spokenBriefing(undefined), '');
});

test('declination direction is stated, not just its size', () => {
  // Boston's -13.9 rounds to 14; Sydney's +12.8 rounds to 13. The direction
  // word is the part that matters -- getting east and west the wrong way round
  // is a 28 degree error here, not a rounding one.
  assert.match(spokenBriefing(boston), /needle here points 14 degrees west of true north/);
  assert.match(spokenBriefing(sydney), /needle here points 13 degrees east of true north/);
});

test('the compass sentence explains itself rather than sounding like a stutter', () => {
  // For WESTERN declination the compass bearing and the declination are always
  // the same number, so "14 degrees on a compass, 14 degrees west declination"
  // reads as a repeat. "because" makes the relationship audible.
  const b = spokenBriefing(boston);
  assert.match(b, /because/);
  assert.doesNotMatch(b, /declination\./, 'do not end on the bare jargon word');
});
