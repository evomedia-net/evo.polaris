import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE TARGET COLUMN IS CAPPED AT THE SCREEN, NOT ITS BUTTONS AT A SIZE.
//
// On a 375x812 phone in full screen, the column of target buttons top-left
// reached down to the top of "Look up" bottom-left: a label overlapping a
// control (#74). The buttons could have been made smaller. The answer was
// explicit -- "We do not want to change the button size. For older phones,
// I would cap the screen." -- so the column is capped above the pad, and
// scrolls within itself when it is too tall. Every button keeps its size.
//
// The cap is arithmetic on the pad's own numbers, and this test does the
// same arithmetic from the same stylesheet: a taller pad, or a bigger pad
// button, fails here instead of quietly overlapping on a phone nobody in
// the room owns.

const css = readFileSync(
  fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');

const block = (sel) => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `${sel} is gone from style.css`);
  return css.slice(i, css.indexOf('}', i));
};
const rem = (b, prop) => {
  const m = b.match(new RegExp(`\\b${prop}:\\s*([\\d.]+)rem`));
  assert.ok(m, `no ${prop} in rem`);
  return Number(m[1]);
};

test('the column is capped at the screen and scrolls, rather than shrinking anything', () => {
  const col = block('.live-sky.full .full-targets {');
  const m = col.match(/max-height:\s*calc\(100% - ([\d.]+)rem\)/);
  assert.ok(m, 'the column must be capped at the screen');
  assert.match(col, /overflow-y:\s*auto/, 'too tall means it scrolls within itself');
  // No button size rule in this block: the cap is the whole fix.
  assert.ok(!/min-height|height:\s*[\d.]+rem/.test(col), 'the column must not size its buttons');
});

test('the cap clears the pad by the pad\'s own arithmetic', () => {
  const cap = Number(block('.live-sky.full .full-targets {').match(/max-height:\s*calc\(100% - ([\d.]+)rem\)/)[1]);
  const padBtn = rem(block('.live-sky.full .map-pan-btn {'), 'height');
  const pad = block('.live-sky.full .full-pan:not([hidden]) {');
  const gap = rem(pad, 'gap');
  // Three rows of pad button, two gaps between them, the pad's bottom inset,
  // the column's top inset, and a gap between column and pad.
  const inset = 0.6;
  const needed = 3 * padBtn + 2 * gap + inset + inset + 0.6;
  assert.ok(cap >= needed - 1e-9,
    `cap of ${cap}rem lets the column reach the pad; it needs at least ${needed.toFixed(2)}rem`);
  // And not absurdly more: a cap that ate half the screen would hide targets
  // on phones that have room for them.
  assert.ok(cap <= needed + 1, `cap of ${cap}rem is ${(cap - needed).toFixed(2)}rem more than the pad needs`);
});

test('the pad buttons themselves are untouched', () => {
  const b = block('.live-sky.full .map-pan-btn {');
  assert.equal(rem(b, 'width'), 3.4);
  assert.equal(rem(b, 'height'), 3.4);
});
