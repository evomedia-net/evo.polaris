// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signedTurn, pointingAltitude, pointingGuidance, guidanceArrow, guidanceText,
} from '../site/src/guide.js';

test('a turn takes the short way round', () => {
  assert.equal(signedTurn(350, 10), 20);      // across north, not 340 the other way
  assert.equal(signedTurn(10, 350), -20);
  assert.equal(signedTurn(90, 90), 0);
  // Dead opposite is a tie: left and right are equally far, so either sign is
  // correct and the magnitude is the only thing worth asserting. Pinning a
  // side here would be testing an arbitrary implementation detail.
  assert.equal(Math.abs(signedTurn(0, 180)), 180);
});

test('tilt maps to the altitude the back of the phone is aimed at', () => {
  // beta 90 is upright, which aims the back of the phone at the horizon.
  assert.equal(pointingAltitude(90), 0);
  assert.equal(pointingAltitude(136), 46);    // the case in the request
  assert.equal(pointingAltitude(0), -90);     // flat, face up -> aimed at the ground
  assert.equal(pointingAltitude(180), 90);    // flat, face down -> aimed at the zenith
});

test('tilt clamps at the zenith instead of wrapping', () => {
  // Past vertical the gesture stops meaning anything; wrapping would make the
  // arrow flip direction as you tip over the top.
  assert.equal(pointingAltitude(200), 90);
  assert.equal(pointingAltitude(-40), -90);
  assert.equal(pointingAltitude(null), null);
});

test('with no heading it asks for the compass and claims nothing', () => {
  const g = pointingGuidance({ targetAz: 0, targetAlt: 46, heading: null, beta: 136 });
  assert.equal(g.state, 'no-heading');
  assert.equal(g.onTarget, false);
  assert.equal(guidanceArrow(g), '•');
  assert.match(guidanceText(g, 'Polaris', 46), /Turn on the compass/);
});

test('both axes right means on target', () => {
  const g = pointingGuidance({ targetAz: 0, targetAlt: 46, heading: 2, beta: 137 });
  assert.equal(g.onAz, true);
  assert.equal(g.onAlt, true);
  assert.equal(g.onTarget, true);
  assert.equal(guidanceArrow(g), '★');
  assert.equal(guidanceText(g, 'Polaris', 46), 'Pointing at Polaris.');
});

test('it corrects the bigger error first', () => {
  // 30 deg off in heading, 6 off in altitude -> fix the heading.
  const a = pointingGuidance({ targetAz: 30, targetAlt: 46, heading: 0, beta: 130 });
  assert.equal(guidanceArrow(a), '▶');
  // 3 off in heading, 25 too low -> raise the phone.
  const b = pointingGuidance({ targetAz: 3, targetAlt: 46, heading: 0, beta: 111 });
  assert.equal(guidanceArrow(b), '▲');
  // and too high points down
  const c = pointingGuidance({ targetAz: 0, targetAlt: 46, heading: 0, beta: 170 });
  assert.equal(guidanceArrow(c), '▼');
});

test('the sentence names both corrections when both are wrong', () => {
  const g = pointingGuidance({ targetAz: 40, targetAlt: 46, heading: 0, beta: 100 });
  const t = guidanceText(g, 'Polaris', 46);
  assert.match(t, /Turn right 40°/);
  assert.match(t, /raise the phone 36°/);
  assert.match(t, /Polaris is 46° above the horizon/);
});

test('a phone with no tilt sensor is told so, not told it is aimed right', () => {
  // The dangerous case: heading correct, altitude unknown. Claiming "on
  // target" here is how someone ends up confidently pointed at the ground.
  const g = pointingGuidance({ targetAz: 0, targetAlt: 46, heading: 1, beta: null });
  assert.equal(g.state, 'heading-only');
  assert.equal(g.onAz, true);
  assert.equal(g.onTarget, false, 'must not claim on-target without tilt');
  const t = guidanceText(g, 'Polaris', 46);
  assert.match(t, /not reporting tilt/);
  assert.match(t, /not being checked/);
});

test('southern targets work the same way', () => {
  // Sydney: the pole bears 180 and sits 34 up, so the phone tilts to beta 124.
  const g = pointingGuidance({ targetAz: 180, targetAlt: 33.87, heading: 180, beta: 123.87 });
  assert.equal(g.onTarget, true);
  assert.equal(guidanceText(g, 'the south pole', 33.87), 'Pointing at the south pole.');
});

test('turning past north does not send you the long way', () => {
  // Heading 350, target 10: the phone should say right 20, never left 340.
  const g = pointingGuidance({ targetAz: 10, targetAlt: 46, heading: 350, beta: 136 });
  assert.ok(g.turn > 0 && g.turn === 20, `turn was ${g.turn}`);
  assert.match(guidanceText(g, 'Polaris', 46), /Turn right 20°/);
});
