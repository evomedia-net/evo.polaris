// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Numbers written out in words.
//
// Why this exists: the latitude setting is read off a screen while your hands
// and attention are on a knob, in the dark, often through a red filter. "42"
// and "24" are one glance apart and transpose easily; "forty-two" does not.
// Spelling it out also gives screen readers and the speech button something
// unambiguous to say -- "42° 30.5′ N" is read aloud very differently by
// different engines, and some drop the units entirely.

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
  'ninety',
];

/** A whole number 0-999 in words. */
export function spellInteger(n) {
  n = Math.trunc(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t}-${ONES[r]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  const r = n % 100;
  return r ? `${h} and ${spellInteger(r)}` : h;
}

/** A number with one decimal place, e.g. 30.5 -> "thirty point five". */
export function spellDecimal(value) {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  const whole = Math.trunc(rounded);
  const tenth = Math.round((rounded - whole) * 10);
  return tenth ? `${spellInteger(whole)} point ${ONES[tenth]}`
    : spellInteger(whole);
}

/**
 * A latitude or longitude spelled out for reading aloud or reading off.
 * @param {{deg:number, min:number, hemi:string}} dm  from astro.toDM()
 * @returns {string} e.g. "forty-two degrees, thirty point five minutes north"
 */
export function spellAngle(dm) {
  const hemi = { N: 'north', S: 'south', E: 'east', W: 'west' }[dm.hemi] || '';
  const degWord = dm.deg === 1 ? 'degree' : 'degrees';
  const minWord = Math.abs(dm.min - 1) < 0.05 ? 'minute' : 'minutes';
  const parts = [`${spellInteger(dm.deg)} ${degWord}`];
  // Drop an exact zero: "forty-two degrees north" reads better than
  // "forty-two degrees, zero minutes, north".
  if (Math.round(dm.min * 10) !== 0) {
    parts.push(`${spellDecimal(dm.min)} ${minWord}`);
  }
  return `${parts.join(', ')}${hemi ? ` ${hemi}` : ''}`;
}

/**
 * The compass point for a bearing, sixteen of them: "ESE" for 112.
 *
 * Sixteen rather than eight because the readout is for pointing a tracker,
 * and "SE" covers forty-five degrees of sky. Each point owns 22.5 degrees
 * centred on itself, so 348.75 is already N again.
 */
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassPoint(deg) {
  const d = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(d / 22.5) % 16];
}

/**
 * The same point in words, for what is SAID rather than drawn (#222). "SE" read
 * out is "S, E"; "south-east" is a direction.
 */
const WORDS = { N: 'north', E: 'east', S: 'south', W: 'west' };
export function compassWords(deg) {
  const p = compassPoint(deg);
  // NNE is "north-north-east": the leading letter, then the two-letter point.
  if (p.length === 3) return `${WORDS[p[0]]}-${WORDS[p[1]]}-${WORDS[p[2]]}`;
  if (p.length === 2) return `${WORDS[p[0]]}-${WORDS[p[1]]}`;
  return WORDS[p];
}

/**
 * The compass line under the sky view, in words (#192).
 *
 * It used to be the raw sensor dump -- "deviceorientationabsolute event ·
 * absolute true · alpha 342° beta 14° ..." -- shown to everyone, and its first
 * number read like a heading when it is not one: the heading is 360 - alpha,
 * so that phone was pointing 18 degrees EAST of north. The dump is still on
 * the page, behind "Show sensor details", for the one person who needs it.
 *
 * The warning keeps the old rule exactly: a plain deviceorientation event that
 * does not say it is absolute may be measuring from wherever the phone
 * happened to point, which turns the sky with no sign that it is wrong.
 *
 * @param {{event: string|null, absolute: boolean|null}} sensor
 * @param {number|null} heading  true heading in degrees, as the app works it out
 */
export function compassSummary(sensor, heading) {
  if (!sensor.event) return '';
  if (sensor.event === 'deviceorientation' && sensor.absolute !== true) {
    return 'This phone did not offer a compass that knows where north is, so '
      + 'the sky may be turned the wrong way. Use the arrow buttons instead.';
  }
  if (!Number.isFinite(heading)) return 'Compass working — waiting for a heading.';
  const d = Math.round(((heading % 360) + 360) % 360) % 360;
  return `Compass working — the phone is pointing ${d}° ${compassPoint(d)}.`;
}
