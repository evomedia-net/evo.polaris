// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * WHEN A SCREEN READER IS TOLD ABOUT THE RING (#221).
 *
 * The status line under the sky view used to be the live region itself, and
 * it is rewritten on every pass of the drawing loop. Tracking the ISS that was
 * 36 rewrites in 15 seconds of a forty-word sentence, and a screen reader
 * re-announces a polite region on every write -- so the sentence restarted,
 * or queued, faster than it could ever be spoken.
 *
 * So what is heard is decided here, apart from what is drawn:
 *  - a new target, a target crossing the horizon, or a new note is said at
 *    once, and so is any press, even of the target already chosen;
 *  - the same words are never said twice in a row;
 *  - a target that only moves is said again when it has moved REPEAT_DEG and
 *    REPEAT_MS has passed since it was last said -- the ISS every half
 *    minute or so, the Moon hardly ever.
 *
 * Pure, so the rule can be tested without a browser.
 */

export const REPEAT_MS = 30000;
export const REPEAT_DEG = 5;

/** The smaller angle between two bearings, in degrees. */
function turn(a, b) {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * Whether to speak.
 *
 * `prev` is what was last said -- { key, text, at, az, alt } -- or null.
 * `now` is what would be said: the same fields, plus `force` for a press.
 * `key` names the situation (which target, above or below the horizon, any
 * note); `az` and `alt` are null for something that does not move.
 *
 * Returns the new `prev` when it should be said, or null when it should not.
 */
export function nextAnnouncement(prev, now) {
  const said = { key: now.key, text: now.text, at: now.at, az: now.az, alt: now.alt };
  if (!prev || now.force || now.key !== prev.key) return said;
  if (!now.text || now.text === prev.text) return null;
  if (now.az == null || prev.az == null) return null;
  const moved = turn(now.az, prev.az) >= REPEAT_DEG || Math.abs(now.alt - prev.alt) >= REPEAT_DEG;
  return moved && now.at - prev.at >= REPEAT_MS ? said : null;
}
