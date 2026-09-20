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
