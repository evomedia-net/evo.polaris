import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SCALE_MIN, SCALE_STEP, SCALE_STEPS, SCALE_MAX, clampScale, scaleLadder,
} from '../site/src/textsize.js';

// FIVE SIZES, AND TWO BUTTONS THAT DO NOT MOVE.
//
// Both halves came out of one round of field testing on a phone.
//
// "I think the button size [ -A ] [ +A ] should have a max of 5. Otherwise the
// buttons just get way too big." Five sizes in all: normal and four bigger,
// nothing below normal.
//
// "The buttons to change the button size jump all over the place when
// enlarging ... they should try to stay locked as well as they get bigger."
// Everything here is sized in rem and rem IS the setting, so the two buttons
// that set it were sized by the number they change: a press resized the button
// under the finger, the bar re-wrapped around it, and the next press landed on
// empty space. evo.ablecamera reached the same rule from the same report (its
// #161): "one base locked size".

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');
const sw = readFileSync(fileURLToPath(new URL('sw.js', root)), 'utf8');

/** The body of one CSS rule, by exact selector. */
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.notEqual(i, -1, `the rule "${selector}" is gone`);
  return css.slice(i, css.indexOf('}', i));
}

// --- the ladder ----------------------------------------------------------------------

test('there are five sizes: the normal one and four bigger', () => {
  const sizes = scaleLadder();
  assert.equal(sizes.length, 5, `five sizes, found ${sizes.length}: ${sizes.join(', ')}`);
  assert.deepEqual(sizes, [1, 1.15, 1.3, 1.45, 1.6]);
  assert.equal(SCALE_MIN, 1, 'the smallest size is the normal one');
  assert.equal(SCALE_MAX, 1.6);
  assert.equal(SCALE_STEPS, 4, 'four presses of A+ from normal, and no more');
});

test('nothing below normal', () => {
  // "Stop at normal": A- walks back to the normal size and stops there.
  for (const below of [0.95, 0.8, 0.5, 0, -3]) {
    assert.equal(clampScale(below), SCALE_MIN, `${below} must come back to normal`);
  }
});

test('a size saved by an older build is brought onto the ladder', () => {
  // The range used to run 0.8 to 1.8 in the same 0.15 step, from a default of
  // 1.0 that was not on ITS ladder either -- so sizes exist in the wild that
  // this one does not offer. Left alone, someone would come back to a size
  // the buttons could no longer walk.
  assert.equal(clampScale(1.8), 1.6, 'the old ceiling comes down to the new one');
  assert.equal(clampScale(1.75), 1.6);
  assert.equal(clampScale(0.8), 1, 'and the old floor comes up to normal');
  // Off-ladder sizes SNAP rather than merely clamping, or the buttons would
  // walk off-ladder for ever from wherever they started.
  assert.equal(clampScale(1.1), 1.15);
  assert.equal(clampScale(1.2), 1.15);
  // The midpoint between the 1.15 and 1.30 rungs is 1.225, and it rounds up.
  assert.equal(clampScale(1.22), 1.15);
  assert.equal(clampScale(1.23), 1.3);
  for (const v of [0.8, 0.95, 1.1, 1.25, 1.4, 1.55, 1.7, 1.8]) {
    assert.ok(scaleLadder().includes(clampScale(v)), `${v} must land on a rung`);
  }
});

test('anything that is not a number is the normal size', () => {
  // localStorage hands back whatever is in it, including nothing at all.
  for (const junk of [undefined, NaN, 'large', {}, [1, 2], Infinity, -Infinity]) {
    assert.equal(clampScale(junk), SCALE_MIN, `${JSON.stringify(junk) ?? junk}`);
  }
  // A number written as a string is still a number.
  assert.equal(clampScale('1.45'), 1.45);
});

test('walking the buttons reaches every size and then stops', () => {
  // The buttons add and subtract a step and hand the result to clampScale, so
  // this is what pressing them actually does.
  let at = clampScale(SCALE_MIN);
  const up = [at];
  for (let i = 0; i < 10; i++) { at = clampScale(at + SCALE_STEP); up.push(at); }
  assert.deepEqual([...new Set(up)], scaleLadder(), 'A+ visits all five, in order');
  assert.equal(at, SCALE_MAX, 'and stays at the top rather than running on');
  const down = [];
  for (let i = 0; i < 10; i++) { at = clampScale(at - SCALE_STEP); down.push(at); }
  assert.deepEqual([...new Set(down)], scaleLadder().reverse().slice(1));
  assert.equal(at, SCALE_MIN, 'A- stops at normal');
});

// --- the app uses it ------------------------------------------------------------------

test('the app reads the ladder rather than keeping its own copy', () => {
  assert.match(appJs, /import \{ SCALE_MIN, SCALE_STEP, SCALE_MAX, clampScale \} from '\.\/textsize\.js';/);
  assert.match(appJs, /let scale = clampScale\(store\.get\('scale', SCALE_MIN\)\);/,
    'what comes out of storage goes through the ladder too');
  assert.match(appJs, /\$\('textBigger'\)\.onclick = \(\) => setScale\(scale \+ SCALE_STEP\);/);
  assert.match(appJs, /\$\('textSmaller'\)\.onclick = \(\) => setScale\(scale - SCALE_STEP\);/);
  const set = appJs.slice(appJs.indexOf('function setScale('), appJs.indexOf("$('textBigger')"));
  assert.match(set, /scale = clampScale\(v\);/, 'one place clamps, so the two buttons cannot differ');
  assert.doesNotMatch(appJs, /Math\.min\(1\.8|Math\.max\(0\.8/, 'the old range is gone');
  assert.match(sw, /'\.\/src\/textsize\.js'/, 'and it is cached for offline use');
});

test('a sizing button at the end of the ladder looks spent', () => {
  const fn = appJs.slice(appJs.indexOf('function applyAppearance('),
    appJs.indexOf("const btn = $('nightToggle')"));
  assert.match(fn, /\['textSmaller', scale <= SCALE_MIN\]/);
  assert.match(fn, /\['textBigger', scale >= SCALE_MAX\]/);
  // aria-disabled, not disabled -- the same reason the zoom buttons give, and
  // it matters more here: a disabled button drops out of the tab order, and
  // this is the pair that must not move out from under the finger.
  assert.match(fn, /setAttribute\('aria-disabled', spent \? 'true' : 'false'\)/);
  assert.doesNotMatch(fn, /\.disabled = /);
  assert.match(rule(".icon-btn[aria-disabled='true']"), /opacity: 0\.45/);
});
