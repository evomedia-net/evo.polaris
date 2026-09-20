// Coordinate entry: turning what someone typed plus which button they pressed
// into one signed number.
//
// Why this is a module with tests rather than three lines in an event handler:
// a dropped minus sign is the worst input bug this app has. Type 33.8688 for
// Sydney instead of -33.8688 and every number on the page changes to a
// complete, confident, northern-hemisphere answer -- wrong pole star, wrong
// reticle circles, wrong chart, azimuth 180 degrees out -- with nothing on
// screen marking it as wrong. Longitude is worse still, because there is no
// hemisphere wording to contradict it: 95.2107 instead of -95.2107 moves you
// from Texas to central China and only the sidereal time quietly disagrees.

/**
 * Combine a typed magnitude with a hemisphere button into a signed value.
 *
 * A typed minus sign WINS over the button. It is an explicit statement, and
 * the alternative -- letting the button silently override it -- reintroduces
 * exactly the bug the buttons exist to remove. The caller normalises the field
 * to the returned magnitude and the button to the returned hemisphere, so the
 * two can never sit on screen disagreeing with each other.
 *
 * @param {string|number} raw       what is in the input
 * @param {string} hemi             the currently selected hemisphere
 * @param {string} negative         which hemisphere means a negative value
 * @returns {{ok:boolean, value:number, hemi:string, magnitude:number}}
 */
export function resolveCoordinate(raw, hemi, negative) {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
  if (!Number.isFinite(n)) {
    return { ok: false, value: NaN, hemi, magnitude: NaN };
  }
  if (n < 0) {
    // Typed negative: honour it and move the button to match.
    return { ok: true, value: n, hemi: negative, magnitude: Math.abs(n) };
  }
  const value = hemi === negative ? -n : n;
  return { ok: true, value, hemi, magnitude: n };
}

/** Which hemisphere button a signed value corresponds to. */
export function hemisphereFor(value, positive, negative) {
  return value < 0 ? negative : positive;
}

/** Latitude must be within +/-90, longitude within +/-180. */
export function validate(value, limit) {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}
