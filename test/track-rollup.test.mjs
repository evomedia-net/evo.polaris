import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE TRACK LIST ROLLS UP.
//
// "I think up top where it says track, it should be an expandable card.
// Click it, the buttons appear. Click it again, they disappear." Asked for
// right after "this screen is getting really crowded now": full screen
// carried sixteen buttons and two plates, and six of the buttons are only
// wanted at the moment of choosing a target.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');

const block = (sel) => {
  const at = css.indexOf(sel);
  assert.notEqual(at, -1, `${sel} is missing from the stylesheet`);
  return css.slice(at, css.indexOf('}', at));
};

test('the heading is a disclosure: name is the section, state is on aria-expanded', () => {
  // The WAI-ARIA disclosure pattern, which is the one exception to "a label
  // says what pressing does": the button carries the section's name and the
  // open/closed state rides on aria-expanded, which a screen reader reads as
  // "Track, button, collapsed". The chevron is the same state for the eye.
  const btn = html.match(/<button id="trackHead"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btn, 'no roll-up button');
  assert.match(btn[0], /aria-expanded="false"/, 'closed by default');
  assert.match(btn[0], /aria-controls="targetGrid"/, 'and it says what it controls');
  assert.match(btn[1], /Track/);
  assert.match(btn[1], /<span class="track-chev" aria-hidden="true">/, 'the chevron is decoration');
});

test('the list starts rolled up, and hidden wins over the grid display', () => {
  assert.match(html, /<div class="target-grid" id="targetGrid"[^>]* hidden>/);
  // A class rule with display: grid beats the attribute's user-agent
  // display: none, so the attribute needs a rule of its own or the roll-up
  // would roll nothing.
  assert.match(block('.target-grid[hidden] {'), /display: none/);
  assert.match(block(".track-head[aria-expanded='true'] .track-chev {"), /rotate\(180deg\)/,
    'the chevron turns when the list is open');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.track-chev \{ transition: none; \}/,
    'and does not animate for anyone who asked it not to');
});

test('one press opens, the next closes, and the choice is remembered', () => {
  const wiring = appJs.slice(appJs.indexOf('function applyTrackOpen('),
    appJs.indexOf("applyTrackOpen(store.get('trackOpen', false) === true);") + 60);
  assert.match(wiring, /setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(wiring, /\$\('targetGrid'\)\.hidden = !open;/);
  assert.match(wiring, /getAttribute\('aria-expanded'\) !== 'true'/, 'a press flips the state');
  assert.match(wiring, /store\.set\('trackOpen', open\)/, 'and keeps it');
  assert.match(wiring, /applyTrackOpen\(store\.get\('trackOpen', false\) === true\);/,
    'closed unless someone opened it before');
});

test('the mode switch is not in the list -- it stays reachable rolled up', () => {
  // "Use Auto Mode" is how the sky is handed back to the phone. It sits
  // under the roll-up, outside it, so rolling the targets away never rolls
  // away the way back.
  const gridStart = html.indexOf('<div class="target-grid" id="targetGrid"');
  const gridEnd = html.indexOf('</div>', gridStart);
  const grid = html.slice(gridStart, gridEnd);
  assert.ok(!grid.includes('id="fullMode"'), 'the mode switch must not roll up with the targets');
  assert.ok(html.indexOf('id="fullMode"') > gridEnd, 'it sits under the list');
  // And every target button IS in the list.
  for (const id of ['tgtPole', 'tgtIss', 'tgtMoon', 'tgtSun', 'tgtPlanets', 'tgtConst']) {
    assert.ok(grid.includes(`id="${id}"`), `${id} must roll up with the rest`);
  }
});
