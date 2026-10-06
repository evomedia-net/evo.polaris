// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// How long the app was actually used.
//
// polaris is one page. Every line in its access log - the document, the
// modules, the stylesheet, the 9,096-star catalogue - arrives in the first
// second or two, so last-minus-first in that log measures how long the assets
// took to download and nothing else. No server-side arithmetic can recover
// dwell time from it; the information was never sent.
//
// So the page says so itself, once, on the way out.
//
// WHAT THIS SENDS: a number of whole seconds, to this site's own origin.
// No identifier, no cookie, nothing written to storage, no coordinates, and
// nothing to a third party. The server already knows the address and
// user-agent from having served the page; this adds one integer to that and
// stops.
//
// The README's "the only request this app ever makes" was about carrying your
// coordinates to Open-Meteo, and that is still a button you press. This is a
// different kind of thing and the README now says so rather than leaving the
// older sentence to quietly become untrue.
//
// IT IS OFF FOR ANYONE WHO HAS ASKED NOT TO BE MEASURED. Do Not Track and
// Global Privacy Control are both honoured. They cost one line each and an app
// built for people the rest of the web ignores should not ignore them.
//
// It also never fires offline, which is not a special case here: sendBeacon
// fails, the catch swallows it, and the field-at-night use this app exists for
// carries on with nothing to notice.

/** The URL nginx answers with 204. Its access-log line is the whole record. */
export const BEACON_PATH = '/api/visit';

/** Below this, a visit is a bounce and not worth a line in the log. */
export const MIN_SECONDS = 10;

/** Long sessions report as they go, so one that never fires pagehide - a
 *  phone sleeping in a field - is not lost entirely. */
export const HEARTBEAT_SECONDS = 120;

/**
 * Whether this elapsed time is worth reporting, and nothing about how.
 *
 * Kept pure and exported so the decision can be tested without a DOM, a
 * clock, or a network: every interesting case here is a boundary.
 *
 * @param {number} elapsed  seconds since the page loaded
 * @param {number} lastSent seconds reported so far, 0 if never
 * @param {boolean} final   the page is going away
 * @returns {boolean}
 */
export function shouldReport(elapsed, lastSent, final) {
  if (!Number.isFinite(elapsed) || elapsed < MIN_SECONDS) return false;
  // Never send the same number twice: a pagehide right after a heartbeat is
  // common, and two identical lines would read as two visits.
  if (elapsed <= lastSent) return false;
  if (final) return true;
  return elapsed - lastSent >= HEARTBEAT_SECONDS;
}

/**
 * Whether the visitor has asked not to be measured.
 *
 * Checked at each send rather than once at start-up: Global Privacy Control
 * can be set by an extension after the page has loaded, and honouring it only
 * if it happened to be there first would be honouring it in name.
 */
export function optedOut(nav = typeof navigator === 'undefined' ? {} : navigator) {
  return nav.globalPrivacyControl === true ||
         nav.doNotTrack === '1' ||
         nav.doNotTrack === 'yes';
}

/**
 * Start reporting. Returns a stop() so tests and callers can end it.
 *
 * Every dependency is injected with a real default, because the alternative is
 * a module that can only be exercised in a browser - and the parts worth
 * testing are the arithmetic and the opt-out, neither of which needs one.
 */
export function startDwellBeacon({
  now = () => Date.now(),
  send = defaultSend,
  nav = typeof navigator === 'undefined' ? {} : navigator,
  doc = typeof document === 'undefined' ? null : document,
  win = typeof window === 'undefined' ? null : window,
} = {}) {
  const started = now();
  let lastSent = 0;
  let timer = null;

  const report = (final) => {
    if (optedOut(nav)) return;
    const elapsed = Math.round((now() - started) / 1000);
    if (!shouldReport(elapsed, lastSent, final)) return;
    lastSent = elapsed;
    try {
      send(`${BEACON_PATH}?s=${elapsed}${final ? '&end=1' : ''}`, nav);
    } catch {
      // Offline, blocked, or a browser without sendBeacon. The app does not
      // care and must not notice.
    }
  };

  const onHide = () => {
    if (!doc || doc.visibilityState === 'hidden') report(true);
  };

  if (doc) doc.addEventListener('visibilitychange', onHide);
  // pagehide as well as visibilitychange: iOS Safari has historically fired
  // one and not the other, and a duplicate is harmless because shouldReport
  // refuses to send the same number twice.
  if (win) win.addEventListener('pagehide', () => report(true));
  if (win) timer = win.setInterval(() => report(false), HEARTBEAT_SECONDS * 1000);

  return function stop() {
    if (doc) doc.removeEventListener('visibilitychange', onHide);
    if (timer && win) win.clearInterval(timer);
  };
}

/** sendBeacon, because it survives the page going away where fetch does not. */
function defaultSend(url, nav) {
  if (nav && typeof nav.sendBeacon === 'function') {
    nav.sendBeacon(url);
    return;
  }
  // Older browsers: keepalive gives fetch the same survival property.
  fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}
