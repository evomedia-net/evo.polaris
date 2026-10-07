// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// HOW BIG THE APP GOES, AS A LADDER OF SIZES.
//
// "I think the button size [ -A ] [ +A ] should have a max of 5. Otherwise the
// buttons just get way too big." Five sizes in all: the normal one and four
// bigger. It ran 0.8 to 1.8 -- six presses up from normal and two down below
// it -- and the top of that range is past the point where the app can lay
// itself out on a phone.
//
// NOTHING BELOW NORMAL, by the same decision. A control whose whole job is to
// make the app readable has no business making it less readable, and every
// size it offers is a size the layout has to survive at every screen width.
//
// A module of its own, like motion.js and walk.js, because it is arithmetic
// with edge cases -- a size saved by an older build, a size that is not on the
// ladder at all -- and arithmetic can be tested without a browser.

export const SCALE_MIN = 1;
export const SCALE_STEP = 0.15;
/** How many sizes ABOVE the normal one. Five in all, counting normal. */
export const SCALE_STEPS = 4;
export const SCALE_MAX = +(SCALE_MIN + SCALE_STEPS * SCALE_STEP).toFixed(2);

/**
 * The nearest size on the ladder, inside the range.
 *
 * Applied to what comes out of storage as well as to what the buttons ask
 * for. Someone who left the app at 1.8 comes back at 1.6 rather than stuck at
 * a size the buttons can no longer walk -- and the old range started at 0.8
 * while the old default sat at 1.0, so sizes exist in the wild that are not on
 * this ladder at all. They are snapped to the nearest rung rather than merely
 * clamped, or the buttons would walk off-ladder for ever from wherever they
 * started.
 *
 * Anything that is not a number at all -- a null from storage, a string that
 * will not parse -- is the normal size.
 */
export function clampScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return SCALE_MIN;
  const rung = Math.round((n - SCALE_MIN) / SCALE_STEP);
  return +(SCALE_MIN + Math.min(SCALE_STEPS, Math.max(0, rung)) * SCALE_STEP).toFixed(2);
}

/** Every size the buttons can reach, smallest first. */
export function scaleLadder() {
  return Array.from({ length: SCALE_STEPS + 1 },
    (_, i) => +(SCALE_MIN + i * SCALE_STEP).toFixed(2));
}
