// The shapes of movement, as pure functions, so they can be tested without a
// frame loop -- which node does not have and a hidden browser tab does not
// run.
//
// Three kinds of motion in the sky view, and they are not the same thing:
//
//   a JOURNEY has a destination and eases into it (the centre button, the
//   target buttons, a tap on the map);
//   a NUDGE is a journey too, but short -- one press of an arrow;
//   a HOLD has no destination at all: the finger is on the button, the sky
//   keeps moving, and it accelerates in and coasts out.
//
// "In manual mode if you press the arrow, it snaps to the point. I would
// really prefer it to just slowly accelerate and stop." The arrows used to
// cut fifteen degrees per press. Now a press is a nudge and a hold is a hold.

/** Leaves quickly, settles gently: the journey's curve. */
export function easeOutCubic(t) {
  const u = Math.max(0, Math.min(1, t));
  return 1 - ((1 - u) ** 3);
}

/** Starts gently, settles gently: the nudge's curve. A press should not lurch. */
export function easeInOutCubic(t) {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
}

/**
 * How fast a held button moves the sky, `elapsed` ms after it went down.
 *
 * Ramps from nothing to `cruise` over `ramp` ms with a smoothstep, so the
 * first frames are slow enough to place a small correction by feel and a
 * long hold gets somewhere. Degrees per millisecond.
 */
export function holdSpeed(elapsed, { ramp = 600, cruise = 0.06 } = {}) {
  const t = Math.max(0, Math.min(1, elapsed / ramp));
  const s = t * t * (3 - 2 * t);
  return cruise * s;
}
