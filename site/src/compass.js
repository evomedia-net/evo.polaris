// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// WHICH WAY IS NORTH, ON A PHONE THAT ONLY SAYS HOW FAR IT HAS TURNED (#295).
//
// "the moon and any object we looked at was actually 180 degrees off axis on
// the iPhone in Safari and Chrome, but it worked fine on my Android".
//
// Android hands the page an absolute orientation: alpha is measured from
// north. Every browser on an iPhone is WebKit, and WebKit starts Core Motion
// with no reference frame, so there alpha is measured from wherever the phone
// faced when the page started listening. The sky view took that as a bearing.
// An iPhone that started out facing the Moon in the south drew the whole sky
// turned half way round, every object off by the same 180 degrees.
//
// The compass does reach the page, separately, as webkitCompassHeading:
// Core Location's MAGNETIC heading, with no declination applied (WebKit fills
// it from CLHeading.magneticHeading). So the fix is an offset, not a new
// reading. Relative alpha is smooth and never jumps, which is exactly what a
// sky view needs; the compass says where north is. Add the two.
//
// WHERE THE OFFSET IS TAKEN, AND WHY ONLY THERE. Apple documents the heading
// as the direction of the top of the device, and does not say what that means
// once the phone is tipped back past upright -- which is how anyone holds it
// to look at the sky, and where "the top of the device" points behind them.
// Between flat-ish and upright every reading of the docs agrees: the top edge,
// the back of the phone and the turn about the vertical all give the same
// bearing, 360 - alpha. So the offset is measured only there, and held
// everywhere else. A phone raised from the hand to the sky passes through that
// band on the way up. Until it has, a reading from anywhere stands in, marked
// provisional, and the first one from inside the band replaces it.

/** Tilt (beta) inside which the compass and alpha are known to agree. */
export const ANCHOR_BETA_MIN = 10;
export const ANCHOR_BETA_MAX = 80;
/** Sideways roll (gamma) past which the back of the phone stops lining up with its top edge. */
export const ANCHOR_GAMMA_MAX = 25;
/** How much of each new reading moves a settled offset: enough to follow
 *  drift in the gyro, not enough for one noisy compass sample to swing it. */
export const ANCHOR_SMOOTH = 0.15;

const wrap = (d) => ((d % 360) + 360) % 360;
/** Shortest signed difference a - b, in (-180, 180]. */
const turn = (a, b) => ((a - b + 540) % 360) - 180;

/** Whether a reading at this tilt and roll can be trusted to set the offset. */
export function inAnchorBand(beta, gamma) {
  return Number.isFinite(beta) && Number.isFinite(gamma)
    && beta >= ANCHOR_BETA_MIN && beta <= ANCHOR_BETA_MAX
    && Math.abs(gamma) <= ANCHOR_GAMMA_MAX;
}

/** What to add to a relative alpha so that 360 - alpha is this compass heading. */
export function anchorSample(alpha, heading) {
  return wrap(360 - heading - alpha);
}

/**
 * Turns a phone's relative alpha into one measured from magnetic north, given
 * the compass heading that arrives with it. Feed it every reading; it returns
 * the absolute alpha, or null when it has nothing to go on yet.
 *
 * @returns {{update: (r: {alpha:number, beta:number, gamma:number, heading:number, accuracy?:number}) => (number|null),
 *            reset: () => void, readonly offset: (number|null), readonly provisional: boolean}}
 */
export function createNorthAnchor() {
  let offset = null;
  let provisional = true;
  return {
    update({ alpha, beta, gamma, heading, accuracy }) {
      if (!Number.isFinite(alpha)) return null;
      // A negative accuracy is Core Location saying the compass is not
      // calibrated: usable as a stand-in, never to settle the offset.
      const usable = Number.isFinite(heading)
        && !(Number.isFinite(accuracy) && accuracy < 0);
      if (Number.isFinite(heading)) {
        const sample = anchorSample(alpha, heading);
        if (usable && inAnchorBand(beta, gamma)) {
          if (offset === null || provisional) {
            offset = sample;
            provisional = false;
          } else {
            offset = wrap(offset + ANCHOR_SMOOTH * turn(sample, offset));
          }
        } else if (offset === null || provisional) {
          offset = sample;
          provisional = true;
        }
      }
      return offset === null ? null : wrap(alpha + offset);
    },
    /** The phone restarts its reckoning when the listener does, so the offset must too. */
    reset() {
      offset = null;
      provisional = true;
    },
    get offset() { return offset; },
    get provisional() { return provisional; },
  };
}
