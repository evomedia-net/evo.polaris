// Two-axis pointing: where the phone is aimed versus where the pole is.
//
// Until now the only live signal was the compass, so the app could say "turn
// left 20 degrees" but the altitude was a constant printed in the sentence --
// "then look 46 degrees up" -- with no idea whether you were anywhere near it.
// This closes that: hold the phone up like a camera, and it guides both axes.
//
// THE TILT CONVENTION, because it is the part that is easy to get backwards.
// DeviceOrientation's `beta` is rotation about the device's x-axis:
//
//     beta =   0   flat on a table, screen up
//     beta =  90   upright, screen facing you
//     beta = 180   flat, screen down
//
// Point the BACK of the phone at something -- the camera-holding gesture, and
// the one people reach for when told to point a phone at the sky -- and that
// direction is the device's -z axis. Flat and face-up, -z points at the ground
// (-90). Upright, -z points at the horizon (0). So:
//
//     altitude the back of the phone is aimed at  =  beta - 90
//
// Aiming at Polaris from 46 degrees north therefore wants beta near 136: the
// phone tilted well back, screen toward your face, looking "through" it.
//
// NOT VERIFIED ON REAL HARDWARE. Like the compass reference question, this
// depends on how a given device reports orientation, and the only honest way
// to settle it is to hold a phone at a known angle and read the number. The
// app shows the raw tilt for exactly that reason -- see `pointingAltitude`.

/** Smallest signed turn from a to b, in -180..180. Positive means clockwise. */
export function signedTurn(fromDeg, toDeg) {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/** The altitude the back of the phone is aimed at, from DeviceOrientation beta. */
export function pointingAltitude(betaDeg) {
  if (betaDeg == null || Number.isNaN(betaDeg)) return null;
  // Clamp rather than wrap. Past vertical the gesture stops meaning anything,
  // and wrapping would make the arrow flip direction as you pass the zenith.
  return Math.max(-90, Math.min(90, betaDeg - 90));
}

/**
 * What to tell someone pointing a phone at the sky.
 *
 * @param {object} p
 * @param {number} p.targetAz    where the pole is, degrees true
 * @param {number} p.targetAlt   how high the pole is, degrees
 * @param {number|null} p.heading  true heading the phone is facing
 * @param {number|null} p.beta     DeviceOrientation beta, or null if unknown
 * @param {number} [p.tolerance]   degrees per axis that counts as on target
 */
export function pointingGuidance({
  targetAz, targetAlt, heading, beta, tolerance = 5,
}) {
  const alt = pointingAltitude(beta);
  const haveAlt = alt !== null;

  if (heading == null) {
    return { state: 'no-heading', turn: null, rise: null, pointingAlt: alt,
             onTarget: false, onAz: false, onAlt: false };
  }

  const turn = signedTurn(heading, targetAz);
  const rise = haveAlt ? targetAlt - alt : null;
  const onAz = Math.abs(turn) <= tolerance;
  const onAlt = haveAlt ? Math.abs(rise) <= tolerance : false;

  return {
    turn,                       // + right, - left
    rise,                       // + raise the phone, - lower it
    pointingAlt: alt,
    onAz,
    onAlt,
    // Without tilt the app can only vouch for the horizontal axis, so it must
    // not claim you are on target -- that is how someone ends up confidently
    // aimed at the ground.
    onTarget: onAz && onAlt,
    state: haveAlt ? 'two-axis' : 'heading-only',
  };
}

/** The arrow to show: the axis that is furthest off gets the pointer. */
export function guidanceArrow(g) {
  if (g.state === 'no-heading') return '•';
  if (g.onTarget) return '★';                       // a star: you are on it
  if (g.state === 'heading-only') return g.onAz ? '▲' : (g.turn > 0 ? '▶' : '◀');
  // Correct the bigger error first; chasing both at once is how people
  // oscillate and never settle.
  if (Math.abs(g.turn) >= Math.abs(g.rise)) {
    return g.turn > 0 ? '▶' : '◀';
  }
  return g.rise > 0 ? '▲' : '▼';
}

/** One sentence describing what to do next. */
export function guidanceText(g, targetName, targetAlt) {
  if (g.state === 'no-heading') {
    return 'Turn on the compass for live directions, or use the chart below.';
  }
  const deg = (n) => `${Math.abs(n).toFixed(0)}°`;

  if (g.state === 'heading-only') {
    // No tilt available: say so rather than implying the altitude is checked.
    return g.onAz
      ? `Facing ${targetName}. Now look ${deg(targetAlt)} up — this phone is not `
        + 'reporting tilt, so that part is not being checked.'
      : `Turn ${g.turn > 0 ? 'right' : 'left'} ${deg(g.turn)}, then look `
        + `${deg(targetAlt)} up.`;
  }

  if (g.onTarget) return `Pointing at ${targetName}.`;

  const parts = [];
  if (!g.onAz) parts.push(`turn ${g.turn > 0 ? 'right' : 'left'} ${deg(g.turn)}`);
  if (!g.onAlt) parts.push(`${g.rise > 0 ? 'raise' : 'lower'} the phone ${deg(g.rise)}`);
  const sentence = parts.join(' and ');
  return `${sentence[0].toUpperCase()}${sentence.slice(1)} — ${targetName} is `
    + `${deg(targetAlt)} above the horizon.`;
}
