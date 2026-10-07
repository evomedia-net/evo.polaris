// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// The spoken briefing: the three numbers, as one sentence you can hear.
//
// It is a module with tests rather than a template literal inside a click
// handler for two reasons. It is the only form of the numbers available to
// someone who cannot see the screen, so it has to be correct in both
// hemispheres and in whatever units it claims. And it is now also PRINTED
// under the button, so the same string has to read well to a deaf user and a
// sighted one, not only sound right.

import { spellAngle } from './words.js';

/**
 * @param {object} solution  from alignmentSolution()
 * @returns {string} plain prose, spoken and displayed from this one source
 */
export function spokenBriefing(solution) {
  if (!solution) return '';

  const dec = solution.declination;
  const decWord = dec >= 0 ? 'east' : 'west';
  const compass = solution.trueNorthOnCompass;

  // Speech engines read "sigma Oct" badly and may skip the glyph entirely, so
  // the spoken form uses the full name while the screen keeps the short one.
  const star = solution.star?.name || 'the pole star';
  const pole = solution.poleName || 'true north';

  const minutes = Math.round(solution.dialMinute);
  const oclock = `${solution.dialHour} o'clock`
    + (minutes ? ` ${minutes} minutes` : '');

  const parts = [
    `Set the altitude axis to ${spellAngle(solution.settings.altitudeAxis)}.`,
    // "14 degrees on a compass, 14 degrees west declination" sounds like a
    // stutter read aloud, and for western declination the two numbers are
    // ALWAYS equal. "because" turns an apparent repeat into the reason.
    `Point the mount at ${pole}. That is ${compass.toFixed(0)} degrees on a `
      + `magnetic compass, because the needle here points `
      + `${Math.abs(dec).toFixed(0)} degrees ${decWord} of true north.`,
    `Put ${star} at ${oclock} on the dial, `
      + `${solution.radiusArcmin.toFixed(0)} arc minutes out from the centre.`,
  ];

  // Sigma Octantis is magnitude 5.5. Reading out "put it here" without saying
  // that is setting someone up to hunt for a star they may not be able to see.
  if (solution.hemisphere === 'south') {
    parts.push('Sigma Octantis is faint — magnitude five and a half — so use '
      + 'the Southern Cross to find the pole first.');
  }

  return parts.join(' ');
}
