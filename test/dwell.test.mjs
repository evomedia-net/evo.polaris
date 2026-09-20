// The dwell beacon: what it sends, when, and who it refuses to measure.
//
// Everything worth testing here is a boundary or a promise, and none of it
// needs a browser - which is why the module takes its clock, its sender and
// its navigator as arguments.
//
// The promises being pinned:
//
//   * a bounce is not a visit
//   * the same number is never sent twice, so one visit is never two lines
//   * Do Not Track and Global Privacy Control are honoured, and honoured when
//     they are set AFTER load rather than only at start-up
//   * the URL carries elapsed seconds and nothing else - no identifier, no
//     coordinates, nothing that could become one
//   * a send that throws is swallowed, because the app is used offline in a
//     field and must not care
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEACON_PATH, MIN_SECONDS, HEARTBEAT_SECONDS,
  shouldReport, optedOut, startDwellBeacon,
} from '../site/src/dwell.js';

// --- shouldReport: the arithmetic ------------------------------------------

test('a bounce is not a visit', () => {
  assert.equal(shouldReport(MIN_SECONDS - 1, 0, true), false);
  assert.equal(shouldReport(0, 0, true), false);
});

test('a real visit reports when the page goes away', () => {
  assert.equal(shouldReport(MIN_SECONDS, 0, true), true);
  assert.equal(shouldReport(45, 0, true), true);
});

test('the same number is never sent twice', () => {
  // pagehide right after a heartbeat is ordinary, and two identical lines in
  // the log would read as two separate visits.
  assert.equal(shouldReport(120, 120, true), false);
  assert.equal(shouldReport(119, 120, true), false);
});

test('a long session reports as it goes, not only at the end', () => {
  assert.equal(shouldReport(HEARTBEAT_SECONDS, 0, false), true);
  assert.equal(shouldReport(HEARTBEAT_SECONDS - 1, 0, false), false);
  // A full step past the last report, not merely a bigger number:
  // 300 against 240 is 60s, half a heartbeat, and must NOT send.
  assert.equal(shouldReport(300, 240, false), false);
  assert.equal(shouldReport(360, 240, false), true);
});

test('a final report is sent even between heartbeats', () => {
  // 130s with 120 already sent is under the heartbeat step, but the page is
  // leaving and this is the last chance to say so.
  assert.equal(shouldReport(130, 120, false), false);
  assert.equal(shouldReport(130, 120, true), true);
});

test('a nonsense clock reports nothing', () => {
  for (const bad of [NaN, Infinity, -5, undefined]) {
    assert.equal(shouldReport(bad, 0, true), false, `elapsed ${bad}`);
  }
});

// --- opting out -------------------------------------------------------------

test('Global Privacy Control is honoured', () => {
  assert.equal(optedOut({ globalPrivacyControl: true }), true);
});

test('Do Not Track is honoured, in both spellings browsers have used', () => {
  assert.equal(optedOut({ doNotTrack: '1' }), true);
  assert.equal(optedOut({ doNotTrack: 'yes' }), true);
});

test('an ordinary visitor is not opted out', () => {
  assert.equal(optedOut({}), false);
  assert.equal(optedOut({ doNotTrack: '0' }), false);
  assert.equal(optedOut({ doNotTrack: null }), false);
});

// --- the beacon end to end --------------------------------------------------

function harness({ nav = {}, seconds = 60 } = {}) {
  const sent = [];
  let t = 1_000_000;
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (k, fn) => { listeners[k] = fn; },
    removeEventListener: () => {},
  };
  const win = {
    addEventListener: (k, fn) => { listeners[k] = fn; },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const stop = startDwellBeacon({
    now: () => t,
    send: (url) => sent.push(url),
    nav, doc, win,
  });
  return {
    sent, listeners, stop,
    advance: (s) => { t += s * 1000; },
    hide: () => { doc.visibilityState = 'hidden'; listeners.visibilitychange(); },
    leave: () => listeners.pagehide(),
  };
}

test('it reports elapsed seconds when the page is hidden', () => {
  const h = harness();
  h.advance(42);
  h.hide();
  assert.deepEqual(h.sent, [`${BEACON_PATH}?s=42&end=1`]);
});

test('the URL carries seconds and nothing else', () => {
  const h = harness();
  h.advance(99);
  h.hide();
  const url = h.sent[0];
  const q = new URLSearchParams(url.split('?')[1]);
  assert.deepEqual([...q.keys()].sort(), ['end', 's']);
  assert.equal(q.get('s'), '99');
  // No identifier of any kind, now or by accident later.
  for (const forbidden of ['id', 'uid', 'sid', 'lat', 'lon', 'cid', 'ref']) {
    assert.equal(q.has(forbidden), false, `must not send ${forbidden}`);
  }
});

test('one visit produces one line, even when both exit events fire', () => {
  // iOS has historically fired one of these and not the other, so both are
  // wired - which means both can fire.
  const h = harness();
  h.advance(30);
  h.hide();
  h.leave();
  assert.equal(h.sent.length, 1);
});

test('a visitor who opted out is never measured', () => {
  const h = harness({ nav: { globalPrivacyControl: true } });
  h.advance(600);
  h.hide();
  assert.deepEqual(h.sent, []);
});

test('opting out after the page loaded still works', () => {
  // An extension can set this late. Honouring it only when it was there first
  // would be honouring it in name.
  const nav = {};
  const h = harness({ nav });
  h.advance(30);
  nav.globalPrivacyControl = true;
  h.hide();
  assert.deepEqual(h.sent, []);
});

test('a bounce sends nothing', () => {
  const h = harness();
  h.advance(3);
  h.hide();
  assert.deepEqual(h.sent, []);
});

test('a send that throws is swallowed', () => {
  // Offline in a field is the situation this app exists for. A beacon that
  // rejects must not surface anywhere.
  const stop = startDwellBeacon({
    now: (() => { let t = 0; return () => (t += 30_000); })(),
    send: () => { throw new Error('offline'); },
    nav: {}, doc: null, win: null,
  });
  assert.equal(typeof stop, 'function');
  stop();
});

test('stop() detaches, so a caller can end it', () => {
  let removed = 0;
  const stop = startDwellBeacon({
    now: () => 0,
    send: () => {},
    nav: {},
    doc: { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => { removed += 1; } },
    win: { addEventListener: () => {}, setInterval: () => 7, clearInterval: () => { removed += 1; } },
  });
  stop();
  assert.equal(removed, 2);
});

// --- the promise the README makes ------------------------------------------

test('the beacon only ever talks to this site', () => {
  const src = BEACON_PATH;
  assert.ok(src.startsWith('/'), 'must be same-origin and relative');
  assert.ok(!/^https?:/i.test(src), 'must not name a host');
});
