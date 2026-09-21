import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// "FIND THE ISS" MOVES THE RING AND THE ARROW; "FIND THE POLE" MOVES THEM BACK.
//
// The ring and the off-screen arrow used to be nailed to the pole, which is
// right for aligning a mount and wrong for the one other thing this view is
// asked to do: show you where the station is. Pressing "Find the ISS" now
// retargets both, and the pole button is the way back -- so it does more than
// re-aim the camera and that is easy to undo by accident.
//
// The accuracy of the pointing itself is covered by iss-track.test.mjs; this
// is the wiring, which is the half that silently comes undone.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');

test('there is one place that decides what is being aimed at', () => {
  assert.match(appJs, /let guideTarget = 'pole';/,
    'guideTarget must exist and start on the pole');
  assert.match(appJs, /function aimTarget\(/,
    'one function must answer "what are the ring and arrow on"');
});

test('the pole button takes the ring off the station', () => {
  // Without this the only way back from the station is a reload, and the pole
  // button would silently re-aim the view while the ring stayed on the ISS.
  const handler = appJs.slice(appJs.indexOf("$('skyPole').onclick"),
    appJs.indexOf("$('skyPole').onclick") + 400);
  assert.match(handler, /guideTarget = 'pole'/,
    '"Find the pole" must reset the target, not just re-aim the view');
  assert.match(appJs, /\$\('fullPole'\)\.onclick = \(\) => \$\('skyPole'\)\.click\(\);/,
    'the full-screen twin must delegate, so it can never drift from it');
});

test('finding the station retargets, and only after it answered', () => {
  const handler = appJs.slice(appJs.indexOf("$('issBtn').onclick"),
    appJs.indexOf("$('skyConst').onclick"));
  assert.match(handler, /guideTarget = 'iss'/,
    '"Find the ISS" must move the target to the station');
  assert.ok(handler.indexOf("guideTarget = 'iss'") > handler.indexOf('await fetchIss()'),
    'the target must only move once the tracker has actually answered');
  assert.match(handler, /issOn = false;/,
    'a failed lookup must leave the station off rather than half-targeted');
});

test('the position is propagated, not the fetched fix reused', () => {
  // The station moves about a degree of look angle per second on a close
  // pass. Pointing at the fetched fix is pointing at empty sky within a
  // minute, which is the whole reason issLookAt exists.
  assert.match(appJs, /import \{[\s\S]*issLookAt[\s\S]*\} from '\.\/iss\.js'/,
    'app.js must import the propagator');
  const fn = appJs.slice(appJs.indexOf('function issNow()'),
    appJs.indexOf('function issNow()') + 700);
  assert.match(fn, /issLookAt\(/, 'issNow must propagate rather than return the fix');
  assert.match(fn, /appTime\(\)/,
    'it must be propagated to the time being shown, so a planned night agrees');
});

test('a target under your feet is still a target', () => {
  // The point of the request: "it should point to the ISS even if it is
  // between a person's feet". aimTarget must not filter on the horizon.
  const fn = appJs.slice(appJs.indexOf('function aimTarget('),
    appJs.indexOf('function aimAtPole('));
  assert.ok(!/aboveHorizon/.test(fn),
    'aimTarget must not refuse a target below the horizon');
});

test('the marker stays in the visible sky even though the target does not', () => {
  // The dot is "there it is"; the ring is "that way". Drawing the dot under
  // the horizon would be drawing the inside of the Earth, so the two rules
  // are deliberately different and both need saying.
  assert.match(appJs, /iss: issLook && issLook\.aboveHorizon/,
    'the drawn marker must still be gated on being above the horizon');
});

test('it says where the station is, including that it is underfoot', () => {
  assert.match(html, /id="skyTarget"/, 'the status line must exist in the markup');
  assert.match(appJs, /BELOW `?\s*\+?\s*'?the horizon/,
    'the status must say plainly when the station is below the horizon');
  // A live region, or the text changes silently for a screen reader.
  const el = html.slice(html.indexOf('id="skyTarget"') - 60,
    html.indexOf('id="skyTarget"') + 60);
  assert.match(el, /role="status"/, '#skyTarget must be a live region');
});

test('tracking redraws far more often than the stars do', () => {
  // A one-second tick, and only while the station is the target: the sky's own
  // twenty-second timer is far too slow for something crossing it in minutes,
  // and running at 1 Hz the rest of the time would be wasted battery.
  assert.match(appJs, /guideTarget === 'iss' && issOn[\s\S]{0,60}\}, 1000\);/,
    'there must be a 1s redraw gated on the station being the target');
});
