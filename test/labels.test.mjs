import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE RULE: A BUTTON'S LABEL SAYS WHAT PRESSING IT WILL DO.
//
// Not what state you are in, not what the thing is called, not a question --
// the action, as an imperative verb phrase. "Turn on the compass", not
// "Compass: off". "Use Night Mode", not "Dark Mode".
//
// This app had five conventions at once. The theme button said "Dark Mode"
// meaning *you are in Dark Mode*; the compass button one card below said "Turn
// on compass" meaning *you are not in compass mode*. Same shape, opposite
// sense, and no way to tell which you were reading.
//
// WHY THE ACTION AND NOT THE STATE, FOR THIS APP. A state label only works if
// you can also perceive which state you are in. Read aloud by a screen reader,
// "button, Dark Mode" carries nothing about what happens next. At 1.8x text in
// a dark field, the highlight that was carrying the state may be exactly the
// part that is hard to make out. The action label needs neither.
//
// THE EXCEPTION, NAMED RATHER THAN LEFT AS DRIFT: a segmented value picker.
// North/South and East/West are not actions, they are the values themselves,
// and the selection is carried by aria-pressed. Those are listed below by id.
//
// This test reads the shipped files, so a new button cannot quietly introduce
// a sixth convention.

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');

/** Value pickers: the label IS the value, and aria-pressed carries the state. */
const VALUE_PICKERS = new Set(['latN', 'latS', 'lonE', 'lonW']);

/** Glyph buttons. Their words live in aria-label, which is checked instead. */
const GLYPH_BUTTONS = new Set(['textSmaller', 'textBigger']);

/**
 * The verbs this app's buttons actually start with. A closed list on purpose:
 * adding a verb should be a decision someone makes, not something that happens
 * because a label was written in a hurry.
 */
const VERBS = new Set([
  'use', 'turn', 'show', 'hide', 'enter', 'look', 'find', 'read', 'follow',
  'stop', 'make', 'switch',
]);

/** Every <button> in the page: id, visible text, aria-label if it has one. */
function buttonsInHtml(src) {
  const out = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  for (const m of src.matchAll(re)) {
    const attrs = m[1];
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    const aria = (attrs.match(/\baria-label="([^"]+)"/) || [])[1];
    const text = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    out.push({ id, aria, text });
  }
  return out;
}

/**
 * Labels assigned at runtime: every string literal on the right of
 * `$('someId').textContent = ...`, including both arms of a ternary.
 *
 * It follows a local alias too -- `const btn = $('nightToggle')` and then
 * `btn.textContent = ...`. Without that the theme button, the one that started
 * all this, was the single button this test could not see.
 */
function runtimeLabels(src, id) {
  const out = [];
  const names = [`\\$\\('${id}'\\)`];
  for (const a of src.matchAll(new RegExp(`const (\\w+) = \\$\\('${id}'\\)`, 'g'))) {
    names.push(a[1]);
  }
  for (const name of names) {
    const re = new RegExp(`${name}\\.textContent\\s*=([\\s\\S]*?);`, 'g');
    for (const m of src.matchAll(re)) {
      for (const lit of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) out.push(lit[1]);
    }
  }
  return out;
}

const firstWord = (s) => (s.trim().split(/[\s,.:]+/)[0] || '').toLowerCase();

function assertActionLabel(label, where) {
  assert.ok(label.length > 0, `${where}: empty label`);
  assert.ok(!/:\s*(on|off)$/i.test(label),
    `${where}: "${label}" names a state with its value. Say the action: `
    + '"Hide the constellations", not "Constellations: on".');
  assert.ok(!label.trim().endsWith('?'),
    `${where}: "${label}" is a question. A button is pressed, not answered.`);
  assert.ok(VERBS.has(firstWord(label)),
    `${where}: "${label}" does not start with an action verb. A label must say `
    + `what pressing does. Known verbs: ${[...VERBS].sort().join(', ')}.`);
}

test('every button in the page is labelled with the action it performs', () => {
  const buttons = buttonsInHtml(html);
  assert.ok(buttons.length > 15, `only found ${buttons.length} buttons`);

  for (const b of buttons) {
    assert.ok(b.id, `a button has no id: "${b.text}"`);
    if (VALUE_PICKERS.has(b.id)) continue;
    const label = GLYPH_BUTTONS.has(b.id) ? b.aria : (b.aria || b.text);
    assertActionLabel(label, `index.html #${b.id}`);
  }
});

test('the labels swapped in at runtime follow the same rule', () => {
  // The toggles are where the two conventions collided, so this is the half
  // that matters most -- and it is invisible in the HTML.
  const ids = buttonsInHtml(html).map((b) => b.id).filter(Boolean);
  let checked = 0;
  for (const id of ids) {
    if (VALUE_PICKERS.has(id)) continue;
    for (const label of runtimeLabels(appJs, id)) {
      assertActionLabel(label, `app.js #${id}`);
      checked++;
    }
  }
  assert.ok(checked >= 8,
    `expected to find runtime labels for the toggles, found ${checked}`);
});

test('every toggle says both directions, and neither is the state it is in', () => {
  // A toggle with one label is a toggle you can only read halfway. Each of
  // these must have two, and they must be opposites of each other.
  const pairs = [
    ['nightToggle', 'Use Night Mode', 'Use Dark Mode'],
    ['compassBtn', 'Turn on the compass', 'Turn off the compass'],
    ['liveSkyBtn', 'Show the live sky view', 'Hide the live sky view'],
    ['skyConst', 'Show the constellations', 'Hide the constellations'],
    ['skyMilky', 'Show the Milky Way', 'Hide the Milky Way'],
    ['manualToggle', 'Enter it by hand instead', 'Hide the hand-entry boxes'],
  ];
  const shipped = new Map(
    buttonsInHtml(html).filter((b) => b.id).map((b) => [b.id, b.text]),
  );
  for (const [id, ...wanted] of pairs) {
    const found = new Set([...runtimeLabels(appJs, id), shipped.get(id)]);
    for (const w of wanted) {
      assert.ok(found.has(w),
        `#${id} never says "${w}". It says: ${[...found].join(' / ')}`);
    }
  }
});

test('the compass button the guide text names is the compass button', () => {
  // The guide tells you to press a button by name. When the button was
  // renamed and the sentence was not, it pointed at a control that no longer
  // existed under that name.
  const guide = readFileSync(fileURLToPath(new URL('src/guide.js', root)), 'utf8');
  const named = guide.match(/Turn on the compass/);
  assert.ok(named, 'guide.js no longer names the compass button');
  assert.ok(html.includes('>Turn on the compass<'),
    'the button guide.js names is not the one in the page');
});
