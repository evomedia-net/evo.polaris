// One button walking a list of targets, as a pure function, so it can be
// tested without a sky.
//
// The Planets and Constellations buttons each walk a list: every press moves
// the ring to the next stop, after the last stop comes "nothing", and then it
// goes round again. Stop number `count` is that "nothing".
//
// SKIPPING WHAT IS DOWN. "When jumping through the constellations and the
// planets ... it would be really nice if we had the ability to only show
// things that are visible in the night sky with a toggle." With it on, a stop
// below the horizon is stepped over instead of landed on. The "nothing" stop
// is never skipped: it is how a walk lets go, and a walk with nothing up at
// all has to be able to end there rather than go round for ever.

/**
 * The stop after `step`, skipping any stop `isUp` says no to.
 *
 * `step` is -1 before the walk has started, so the first press lands on the
 * first stop that is up. `isUp(i)` is asked about stop i, 0 <= i < count.
 */
export function nextStop(step, count, isUp) {
  for (let k = 1; k <= count + 1; k++) {
    const s = (step + k) % (count + 1);
    if (s === count || isUp(s)) return s;
  }
  return count;
}
