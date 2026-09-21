import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE KEY TO THE DASHED PATHS, AND WHY IT IS NOT JUST A BOX OF COLOURS.
//
// Three kinds of path cross the sky map -- the station, the planets, the Moon
// -- and until now the only thing telling them apart was hue. That fails in
// the two places this app is actually used:
//
//   * NIGHT MODE. Every track collapses to a shade of red, because that is
//     the entire point of Night Mode. A key by hue would be useless exactly
//     where the app is meant to work.
//   * COLOUR BLINDNESS. The planets were pale yellow and the Moon near-white,
//     on the same dash, in daylight. WCAG 1.4.1: colour must not be the only
//     thing carrying a difference.
//
// So each path now has its own DASH as well as its own colour, and the key
// draws the real dash. The dash and the colour come from one table that the
// map and the key both read, because a key that disagrees with the picture is
// worse than no key at all.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');

/** The TRACK_STYLE table, parsed out of the source. */
function trackStyles() {
  const block = appJs.slice(appJs.indexOf('const TRACK_STYLE = {'),
    appJs.indexOf('};', appJs.indexOf('const TRACK_STYLE = {')));
  assert.notEqual(block.length, 0, 'TRACK_STYLE is gone');
  const out = {};
  for (const m of block.matchAll(
    /(\w+):\s*\{[^}]*colour:\s*'(#[0-9a-fA-F]+)'[^}]*nightColour:\s*'(#[0-9a-fA-F]+)'[^}]*dash:\s*\[([^\]]+)\]/g)) {
    out[m[1]] = { colour: m[2], nightColour: m[3], dash: m[4].replace(/\s/g, '') };
  }
  return out;
}

test('every path has its own dash, not only its own colour', () => {
  const styles = trackStyles();
  assert.deepEqual(Object.keys(styles).sort(), ['iss', 'moon', 'planets'],
    'the table must cover exactly the three drawn paths');
  const dashes = Object.values(styles).map((s) => s.dash);
  assert.equal(new Set(dashes).size, dashes.length,
    `two paths share a dash (${dashes.join(' | ')}) — in Night Mode they `
    + 'become the same red and nothing tells them apart');
});

test('night colours stay on the red channel', () => {
  // Night Mode is pure red on black; a swatch that leaked green or blue would
  // be the one thing on screen destroying dark adaptation.
  for (const [name, s] of Object.entries(trackStyles())) {
    assert.match(s.nightColour, /^#[0-9a-f]{2}0000$/i,
      `${name}'s night colour ${s.nightColour} is not pure red`);
  }
});

test('the map reads its styles from the same table the key does', () => {
  // The whole point. If a track goes back to spelling its own colour and dash
  // inline, the key silently starts lying.
  for (const key of ['planets', 'moon', 'iss']) {
    assert.ok(appJs.includes(`...TRACK_STYLE.${key}`),
      `the ${key} track must spread TRACK_STYLE.${key}, not repeat it`);
  }
  const fn = appJs.slice(appJs.indexOf('function updateLegend()'),
    appJs.indexOf('function updateLegend()') + 900);
  assert.match(fn, /TRACK_STYLE\[key\]/, 'the key must read the same table');
  assert.match(fn, /stroke-dasharray/, 'the key must draw the real dash');
  assert.match(fn, /night \? style\.nightColour : style\.colour/,
    'the swatch must follow the theme the tracks follow');
});

test('the key is real text in the corner, not paint on the canvas', () => {
  // Painted onto the canvas it would be invisible to a screen reader and
  // would not grow with A+ -- a key only sighted users at default text size
  // could use, which is the thing this app does not do.
  assert.match(html, /<ul class="sky-legend" id="skyLegend"/,
    'the key must be a list in the markup');
  assert.match(html, /aria-label="What the dashed paths mean"/);
  for (const id of ['legIss', 'legPlanets', 'legMoon']) {
    assert.ok(html.includes(`id="${id}"`), `the ${id} row is missing`);
  }
  // The swatch is decoration; the word beside it carries the meaning.
  const rows = html.slice(html.indexOf('id="skyLegend"'), html.indexOf('</ul>'));
  assert.equal((rows.match(/aria-hidden="true"/g) || []).length, 3,
    'each swatch must be hidden from assistive tech, leaving the word');
});

test('the key never eats a tap meant for the map', () => {
  const rule = css.slice(css.indexOf('\n.sky-legend {'),
    css.indexOf('}', css.indexOf('\n.sky-legend {')));
  assert.match(rule, /pointer-events:\s*none/,
    'a key is not a control — it must not take presses');
  assert.match(rule, /top:/, 'the key belongs in the top corner');
  assert.match(rule, /right:/, 'the key belongs in the RIGHT corner');
  // Bottom right is the fill-the-screen button and the zoom; bottom left is
  // the pad; bottom centre is the mode button. Top right is the free corner.
  assert.ok(!/bottom:/.test(rule), 'the bottom corners are already taken');
});

test('a row appears only when its path is actually drawn', () => {
  // A key to a line that is not on the map sends someone hunting the sky for
  // something that was never there.
  const fn = appJs.slice(appJs.indexOf('function updateLegend()'),
    appJs.indexOf('function updateLegend()') + 900);
  assert.match(fn, /\['legIss', 'iss', !!issSamples\]/,
    'the station row must follow whether its orbit has been fetched');
  assert.match(fn, /\['legPlanets', 'planets', skyShowPlanets\]/);
  assert.match(fn, /\['legMoon', 'moon', skyShowMoon\]/);
  assert.match(fn, /\$\('skyLegend'\)\.hidden = !any;/,
    'the whole plate must go when nothing is drawn');
});

test('hiding a body takes its path with it at once', () => {
  // The tracks are assembled in refreshSkyVectors and gated on these same
  // switches, so a plain redraw left the labelled PATH on screen for up to
  // twenty seconds after its dot vanished -- and the key would have been
  // right while the map was wrong.
  for (const id of ['skyPlanets', 'skyMoon']) {
    const h = appJs.slice(appJs.indexOf(`$('${id}').onclick`),
      appJs.indexOf(`$('${id}').onclick`) + 320);
    assert.match(h, /refreshSkyVectors\(\)/,
      `#${id} must rebuild the tracks, not only redraw`);
  }
  // Same trap on the way in: the station's path is built there too.
  const iss = appJs.slice(appJs.indexOf("$('issBtn').onclick"),
    appJs.indexOf("$('skyConst').onclick"));
  assert.match(iss, /refreshSkyVectors\(\)/,
    'fetching the station must rebuild its path, or the key gains a row '
    + 'before the line it refers to appears');
});
