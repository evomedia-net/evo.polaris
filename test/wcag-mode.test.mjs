// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// WCAG MODE (#218).
//
// "This needs a WCAG complient version that can be toggled at top, next to
// -A / +A ... do not modify any current settings, add this as a new option."
// A conforming alternate version: a switch in the header, and a set of rules
// that only ever apply while it is on. These tests hold both halves -- the
// switch is where Kelly asked for it, and nothing it does leaks into the
// modes that already existed.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = read('../site/index.html');
const css = read('../site/src/style.css');
const app = read('../site/src/app.js');

const WCAG_SECTION = css.slice(css.indexOf('/* --- WCAG MODE (#218)'));

/** Every selector of every rule in a stretch of CSS, comments removed. */
function selectors(chunk) {
  const bare = chunk.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of bare.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const s of m[1].split(',')) if (s.trim()) out.push(s.trim());
  }
  return out;
}

test('the switch is in the header beside A- / A+, after them, and says what pressing does', () => {
  const sizing = html.slice(html.indexOf('<div class="sizing">'), html.indexOf('</div>', html.indexOf('<div class="sizing">')));
  assert.match(sizing, /<button id="wcagToggle" class="icon-btn wcag-btn">Use WCAG Mode<\/button>/);
  assert.ok(sizing.indexOf('textBigger') < sizing.indexOf('wcagToggle'), 'under the pair, not between them');
  // Under the pair at their combined width, so the pair keeps its corner.
  assert.match(css, /\.sizing \{[^}]*flex-wrap: wrap;[^}]*max-width: calc\(2 \* var\(--tap-lock\) \+ 0\.4 \* var\(--base\)\);/);
  assert.match(css, /\.sizing \.wcag-btn \{[^}]*flex: 1 0 100%;/);
});

test('it is remembered, sets data-wcag, and its label names the mode it switches to', () => {
  assert.match(app, /let wcag = store\.get\('wcag', false\);/);
  assert.match(app, /dataset\.wcag = wcag \? 'on' : 'off';/);
  assert.match(app, /wb\.textContent = wcag \? 'Exit WCAG Mode' : 'Use WCAG Mode';/);
  // The spoken name carries the words on the button (WCAG 2.5.3).
  for (const words of ['Exit WCAG Mode', 'Use WCAG Mode']) {
    assert.match(app, new RegExp(`\\? '${words}\\.|: '${words},`), `the name must contain "${words}"`);
  }
  // NEVER "NORMAL". Kelly: '"Normal" mode text implies disabled are not
  // "Normal"'. The button says what it does and names nobody.
  for (const src of [app, html]) assert.doesNotMatch(src, /Normal Mode/);
  assert.match(app, /\$\('wcagToggle'\)\.onclick = \(\) => \{\s*wcag = !wcag; store\.set\('wcag', wcag\); applyAppearance\(\);/);
});

test('every rule WCAG Mode adds applies only while it is on', () => {
  assert.ok(WCAG_SECTION.length > 200, 'the WCAG Mode section of style.css is missing');
  const loose = selectors(WCAG_SECTION).filter((s) => !s.startsWith("html[data-wcag='on']") && s !== '.leg-fold');
  assert.deepEqual(loose, [], 'a WCAG Mode rule without html[data-wcag=\'on\'] changes the default mode too');
  // .leg-fold is the one exception, and it only ever hides.
  assert.match(WCAG_SECTION, /\n\.leg-fold \{ display: none; \}/);
});

test('in full screen the key folds behind Show the Key, and the credits stay', () => {
  const legend = html.slice(html.indexOf('id="skyLegend"'), html.indexOf('</ul>', html.indexOf('id="skyLegend"')));
  assert.match(legend, /<li class="leg-fold"><button id="keyFold" class="map-btn key-fold">Show the Key<\/button><\/li>/);
  assert.match(WCAG_SECTION, /html\[data-wcag='on'\] \.live-sky\.full \.leg-fold \{ display: flex; \}/);
  const folded = selectors(WCAG_SECTION).filter((s) => s.includes('.folded'));
  assert.deepEqual(folded.map((s) => s.split(' ').pop()).sort(), ['#legIss', '#legMoon', '#legPlanets'],
    'the fold hides the three path rows and nothing else');
  // ESO's terms keep the Milky Way's credit on the picture: never folded.
  for (const credit of ['legMilky', 'legPlanetArt', 'legFigures']) {
    assert.ok(!folded.some((s) => s.includes(credit)), `#${credit} must never fold away`);
  }
  // Folded unless opened, remembered, and labelled with the action.
  assert.match(app, /let keyOpen = store\.get\('keyOpen', false\);/);
  assert.match(app, /kf\.textContent = keyOpen \? 'Hide the Key' : 'Show the Key';/);
});

test('folded, the plate is locked to --base so A+ cannot grow it into the controls', () => {
  const fold = WCAG_SECTION.slice(WCAG_SECTION.indexOf("html[data-wcag='on'] .live-sky.full .key-fold {"));
  const rule = fold.slice(0, fold.indexOf('}'));
  assert.match(rule, /min-height: var\(--tap-lock\);/, 'the locked 58px, over the 44px AAA target');
  assert.match(rule, /font-size: var\(--base\);/);
  assert.match(rule, /pointer-events: auto;/, 'the plate ignores the pointer; its button must not');
  assert.match(WCAG_SECTION, /\.live-sky\.full \.leg-credit \{ font-size: calc\(0\.68 \* var\(--base\)\); \}/);
});

test('the full-screen Track labels wrap rather than being cut off (#180)', () => {
  assert.match(WCAG_SECTION, /html\[data-wcag='on'\] \.live-sky\.full \.tgt-btn \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
});

test('focus is kept clear of the pinned bar, by padding and by script (2.4.11)', () => {
  assert.match(WCAG_SECTION, /html\[data-wcag='on'\] \{ scroll-padding-top: calc\(var\(--bar-h, 0px\) \+ 0\.5rem\); \}/);
  assert.match(app, /setProperty\('--bar-h', tall \? '0px' : `\$\{Math\.ceil\(h\)\}px`\)/);
  const handler = app.slice(app.indexOf("document.addEventListener('focusin'"));
  assert.match(handler.slice(0, 200), /if \(!wcag\) return;/, 'the scroll must only happen in WCAG Mode');
});

test('a rejected field is marked and linked to its message, only in WCAG Mode (3.3.1)', () => {
  const fn = app.slice(app.indexOf('function markInvalid('), app.indexOf("$('manualApply').onclick"));
  assert.match(fn, /const bad = wcag && f === id;/);
  assert.match(fn, /setAttribute\('aria-invalid', 'true'\)/);
  assert.match(fn, /setAttribute\('aria-describedby', 'locateStatus'\)/);
  assert.match(fn, /if \(wcag && id\) \$\(id\)\.focus\(\);/);
  const apply = app.slice(app.indexOf("$('manualApply').onclick"));
  assert.match(apply, /markInvalid\('inLat'\)/);
  assert.match(apply, /markInvalid\('inLon'\)/);
  assert.match(apply, /markInvalid\(null\)/);
});

test('links are underlined and the credits drawn at full ink (1.4.1, 1.4.3)', () => {
  assert.match(WCAG_SECTION, /html\[data-wcag='on'\] a:not\(\.icon-btn\) \{ text-decoration: underline; \}/);
  assert.match(WCAG_SECTION, /html\[data-wcag='on'\] \.leg-credit,\s*html\[data-wcag='on'\] \.milky-credit \{ opacity: 1; \}/);
});
