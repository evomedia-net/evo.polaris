import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE CARD FOLLOWS THE MODE, NOT THE SENSOR.
//
// Reported: "manual controls are expanded on load but system is in auto
// mode". The card was driven by
//
//     const following = skyFollow && rawAlpha !== null;
//
// which is not the mode -- it is the mode AND a compass reading having
// actually arrived. On load skyFollow is already true and rawAlpha is still
// null, so `following` was false and the card sprang open while the button
// beside it said Auto Mode. On iOS the first reading waits for a permission
// tap; on a laptop it never comes at all, so this was not a flicker during
// startup but the resting state of the app.
//
// The same trap had already been caught once, for the mode button's own
// label, and the note explaining it sits a few lines below the card code:
// "THE LABEL FOLLOWS THE INTENT, NOT THE ACHIEVED STATE". Two variables one
// character apart in meaning, and the card was wired to the wrong one.
//
// These are source assertions because app.js drives the DOM and this repo has
// no DOM: zero dependencies, no jsdom. The behaviour is pinned by reading the
// code, and the reasoning is written here because the next person cannot run
// it either.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');

/**
 * Source with `//` comments removed. The prose in this file quotes the very
 * strings and variable names being asserted against, so without this a
 * comment explaining an old bug reads as the old bug still being present --
 * which is exactly how the first draft of this test failed against correct
 * code.
 */
const code = (src) => src.replace(/^\s*\/\/.*$/gm, '');

/** The block that opens and shuts the Manual Controls card. */
const cardBlock = (() => {
  const i = appJs.indexOf('if (skyFollow !== lastFollowMode)');
  assert.ok(i > 0, 'the card is no longer driven by the mode — see this file');
  // Searched FROM the block, not from the start of the file: app.js sets
  // `card.open` in the card-restoring loop 1200 lines earlier, and indexing
  // from zero found that one and sliced an empty string that passed nothing.
  return appJs.slice(i, appJs.indexOf('}', appJs.indexOf('card.open', i)) + 1);
})();

test('the card is opened from the mode, not from a sensor reading', () => {
  assert.match(cardBlock, /card\.open = !skyFollow;/,
    'the card must follow the selected mode');
  // THE REGRESSION ITSELF. `following` is the sensor-aware one; if it comes
  // back here, the card opens on load in Auto again.
  assert.ok(!/\bfollowing\b/.test(code(cardBlock)),
    'the card is driven by `following` again, which is true only once a '
    + 'compass reading has ARRIVED — on load, and for ever on a device with '
    + 'no compass, that is false while Auto Mode is the mode');
});

test('on load, in Auto, it is shut', () => {
  // The three facts that together decide what the user sees in the first
  // frame. Auto is the starting mode, the tracker starts unset so the very
  // first pass through always applies the mode, and the markup does not open
  // the card behind the code's back.
  assert.match(appJs, /let skyFollow = true;/, 'Auto is the mode on load');
  assert.match(appJs, /let lastFollowMode = null;/,
    'the tracker must start unset, or the first pass is skipped and the '
    + 'markup decides instead');
  const card = html.slice(html.indexOf('id="manualCard"') - 60,
    html.indexOf('id="manualCard"') + 20);
  assert.ok(!/\bopen\b/.test(card),
    `the markup opens the card before any code runs: ${card.trim()}`);
});

test('a hand on the card beats a redraw', () => {
  // updateSkyMode runs on every frame. Forcing the card each time would snap
  // it shut under anyone who opened it while the phone was steering, which is
  // a legitimate thing to do -- the arrows take over on a press.
  assert.match(cardBlock, /^if \(skyFollow !== lastFollowMode\) \{/,
    'the card must be set only when the mode CHANGES');
  assert.match(cardBlock, /lastFollowMode = skyFollow;/,
    'and the tracker must be updated, or every frame re-applies it');
});

test('the card is not remembered, and the settings drawer is', () => {
  // Which mode you are in decides the card, so a stored "open" would fight
  // the next mode change. Visual Settings is a drawer of preferences: a
  // drawer you shut should stay shut.
  assert.match(appJs, /CARDS_THE_APP_OWNS = new Set\(\['manualCard'\]\)/);
  assert.ok(!/CARDS_THE_APP_OWNS[^\n]*visualCard/.test(appJs),
    'Visual Settings must keep remembering what the user did to it');
});

test('Auto-with-no-compass says where the arrows actually are', () => {
  // THE OTHER HALF OF THE BUG. A declined or absent compass never drops
  // skyFollow, so "Auto selected, nothing steering" is permanent on a laptop,
  // not transient. The status line promised "the arrows work meanwhile" --
  // true when the pad was always on screen, false once it is behind a
  // disclosure. Collapsing the card without fixing the sentence would have
  // traded one wrong thing on screen for another.
  const start = appJs.indexOf('} else if (skyFollow) {');
  const waiting = code(appJs.slice(start, appJs.indexOf('} else {', start)))
    // The source wraps these strings across lines with ' + ', so the joins
    // come out before matching -- the sentence is never contiguous on one
    // line, and asserting on the raw text failed against correct code.
    .replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.ok(!/the arrows work meanwhile/.test(waiting),
    'this sentence points at controls that are now collapsed');
  // Both cases: the iOS one waiting for a tap, and the device that will never
  // report at all.
  const [pending, never] = waiting.split(/\bcompassPending\b\s*\?/)[1].split(" : ");
  assert.match(pending, /arrows under Manual Controls work either way/,
    'the pending-permission case must say where the arrows are');
  assert.match(never, /open Manual Controls/,
    'and the no-compass case must too, since for that device it is permanent');
});

test('full screen keeps its pad on the sensor, deliberately', () => {
  // NOT an oversight, and not a consistency fix waiting to happen. Full
  // screen has no card to open, so if the pad were hidden whenever Auto was
  // merely SELECTED, a laptop or a phone with the compass declined would have
  // no way to steer at all there.
  assert.match(appJs, /\$\('fullPan'\)\.hidden = following;/,
    'the full-screen pad must stay driven by whether anything is actually '
    + 'steering — hiding it on the mode alone strands the full-screen view');
});
