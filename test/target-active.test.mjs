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
const html = readFileSync(
  fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
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
  assert.match(h, /planetStep = nextStop\(planetStep, PLANET_NAMES\.length,/);
  assert.ok(!/guideTarget === 'none'/.test(h), 'the planets button must not short-circuit its cycle');
});

// --- the active button looks active ------------------------------------------------

test('a pressed target button goes green -- text and border, not a fill', () => {
  // "If you click ISS, the button text should turn green and so should the
  // border." A solid accent fill was the first attempt; green on the plate
  // reads at a glance against the other buttons, keeps the plate's contrast
  // with the sky behind it, and matches the ring and arrow it describes.
  const b = block(".target-grid button[aria-pressed='true'] {");
  assert.match(b, /color: var\(--accent\)/, 'the text turns green');
  assert.match(b, /border-color: var\(--accent\)/, 'and so does the border');
  assert.ok(!/background: var\(--accent\)/.test(b), 'and it is not filled');
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
  // Moon in a browser and reading the computed style: still the plate.
  const b = block(".live-sky.full .full-targets button[aria-pressed='true'] {");
  assert.match(b, /color: var\(--accent\)/);
  assert.match(b, /border-color: var\(--accent\)/);
});

test('the accent is what both pickers use to mean "this one"', () => {
  // The hemisphere picker fills with the accent; the targets colour their
  // text and border with it. Different surfaces -- one in a card, one over
  // the sky -- but one colour meaning one thing, and on the map it is the
  // colour of the ring and the arrow the button is about.
  assert.match(block(".hemi-btn[aria-pressed='true'] {"), /var\(--accent\)/);
  assert.match(block(".target-grid button[aria-pressed='true'] {"), /var\(--accent\)/);
});

// --- the caption is a caption ----------------------------------------------------------

test('there is no target name row at all any more', () => {
  // It named what the lit button already says, and looked exactly like the
  // buttons above it -- "literally identical to the button you press" --
  // which invited a press that did nothing. The green button carries which
  // target is live; "has set" lives beside the ring on the map and in the
  // #skyTarget live region, which is the one a screen reader reads.
  assert.ok(!css.includes('.target-name'), "the caption's styles must go with it");
  assert.ok(!appJs.includes('fullTargetName'), 'and nothing may still write to it');
});

test('the Track heading is a button now, because pressing it does something', () => {
  // It was pinned as a label that must NOT read as a button, because the
  // row under the list had been removed for looking exactly like one and
  // inviting a press that did nothing. The rule was never "no buttons": it
  // was "nothing that looks pressable and is not". Now a press on the
  // heading rolls the list up and down, so it looks like what it is -- the
  // same plate as its neighbours -- and it still names the group.
  assert.match(html, /<button id="trackHead" class="map-btn tgt-btn track-head" aria-expanded="false" aria-controls="targetGrid">/);
  assert.match(block('.track-head {'), /text-transform: uppercase/, 'the section name, in small capitals');
  assert.ok(!/pointer-events: none/.test(block('.track-head {')), 'it takes a press now');
  assert.match(html, /<div class="target-grid" id="targetGrid" role="group" aria-labelledby="trackHead" hidden>/);
});
