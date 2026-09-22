import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE ACTIVE TARGET LOOKS ACTIVE, AND PRESSING IT AGAIN LETS GO.
//
// "When you select a target, if you press again it should deselect it. And
// also the target at the bottom, the button, looks exactly like the target
// button you press to tell you which one's active. The one that's active
// should look different. It should be a different color. The border should
// change."
//
// Two things were wrong. A pressed target button did nothing on a second
// press -- a switch with no off. And the caption under the buttons, which
// is not a button, was a bordered plate the same shape as the buttons above
// it, while the button that WAS pressed looked like the rest. So the state
// was visible only as a ring somewhere on the map.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const css = readFileSync(
  fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');

const block = (sel) => {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `${sel} is gone from style.css`);
  return css.slice(i, css.indexOf('}', i));
};

// --- pressing again lets go -----------------------------------------------------

test('the pole button lets go on a second press', () => {
  const h = appJs.slice(appJs.indexOf("$('tgtPole').onclick"), appJs.indexOf("$('tgtMoon').onclick"));
  assert.match(h, /if \(guideTarget === 'pole'\) \{ setTarget\('none'\); return; \}/,
    'pressing the active pole must clear the target, not re-aim');
  assert.match(h, /\$\('skyPole'\)\.click\(\);/, 'and otherwise still find the pole');
});

test('the Moon button lets go on a second press', () => {
  assert.match(appJs, /\$\('tgtMoon'\)\.onclick = \(\) => goToTarget\(guideTarget === 'moon' \? 'none' : 'moon'\);/);
});

test('the ISS button lets go on a second press, before it would ask the network', () => {
  const h = appJs.slice(appJs.indexOf("$('tgtIss').onclick"), appJs.indexOf('// OUT FROM THE SUN'));
  assert.match(h, /if \(guideTarget === 'iss'\) \{ setTarget\('none'\); return; \}/);
  assert.ok(h.indexOf("guideTarget === 'iss'") < h.indexOf('loadIss('),
    'letting go must not fetch anything');
});

test('the Planets button keeps walking the list; letting go is its last stop', () => {
  // The one exception, and it is the earlier request: each tap cycles, out
  // from the Sun, then nothing, then round again.
  const h = appJs.slice(appJs.indexOf("$('tgtPlanets').onclick"), appJs.indexOf('// The sky turns a quarter'));
  assert.match(h, /planetStep = \(planetStep \+ 1\) % \(PLANET_NAMES\.length \+ 1\);/);
  assert.ok(!/guideTarget === 'none'/.test(h), 'the planets button must not short-circuit its cycle');
});

// --- the active button looks active ------------------------------------------------

test('a pressed target button is filled with the accent by day', () => {
  // On the STATE, not on a class: the first version matched .big-btn, which
  // these buttons do not carry (they are .map-btn .tgt-btn), so the rule was
  // written, the state was set, and nothing changed. Found by pressing the
  // Moon in a browser and reading the computed background: still the plate.
  const b = block(".target-grid button[aria-pressed='true'] {");
  assert.match(b, /background: var\(--accent\)/, 'a different colour');
  assert.match(b, /border-color: var\(--accent\)/, 'the border changes');
  assert.match(b, /color: var\(--accent-ink\)/, 'and the text stays readable on it');
});

test('and in Night Mode says so with a heavier border, filling nothing', () => {
  const b = block("html[data-night='on'] .target-grid button[aria-pressed='true'] {");
  assert.match(b, /background: transparent/, 'night mode fills nothing brightly');
  assert.match(b, /border-width: 3px/, 'so the state is carried by weight');
  assert.match(b, /border-color: var\(--ink\)/);
});

test('the pressed look outranks the full-screen plate', () => {
  // The full-screen buttons wear a translucent plate from a three-class
  // rule. A pressed rule of lower weight is silently beaten by it -- the
  // state set, the rule written, the button unchanged. Found by pressing the
  // Moon in a browser and reading the computed background: still the plate.
  const b = block(".live-sky.full .full-targets button[aria-pressed='true'] {");
  assert.match(b, /background: var\(--accent\)/);
  assert.match(b, /border-color: var\(--accent\)/);
  const n = block("html[data-night='on'] .live-sky.full .full-targets button[aria-pressed='true'] {");
  assert.match(n, /border-width: 3px/);
});

test('it is the same treatment the hemisphere picker gives its chosen side', () => {
  // One convention for "this is the selected one", not two.
  const hemi = block(".hemi-btn[aria-pressed='true'] {");
  const tgt = block(".target-grid button[aria-pressed='true'] {");
  for (const prop of ['background: var(--accent)', 'border-color: var(--accent)', 'color: var(--accent-ink)']) {
    assert.ok(hemi.includes(prop) && tgt.includes(prop), `${prop} must be shared`);
  }
});

// --- the caption is a caption ----------------------------------------------------------

test('the target name under the buttons is not shaped like a button', () => {
  const day = block('.target-name {');
  assert.match(day, /border: none/, 'no border');
  assert.match(day, /background: transparent/, 'no plate');
  assert.ok(!/border-radius/.test(day), 'no rounded plate');
  assert.match(day, /color: var\(--accent\)/, 'the ring\'s own colour: it is the ring\'s caption');
  assert.match(day, /text-shadow/, 'legible over the sky without a plate');
  const night = block("html[data-night='on'] .target-name {");
  assert.match(night, /background: transparent/);
  assert.match(night, /border: none/);
});
