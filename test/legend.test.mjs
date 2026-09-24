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
});

test('windowed the key is under the picture, and out of the picture box', () => {
  // It was a plate on the map in both views, and on a phone it did not fit:
  // the windowed canvas is 3:2, about 270x180 at 375px wide, and the key is
  // six rows of text -- taller than the canvas at the largest size. It
  // overlapped the readout and Fill the screen at EVERY size, the default
  // included; large text only made a standing bug obvious.
  const rule = css.slice(css.indexOf('\n.sky-legend {'),
    css.indexOf('}', css.indexOf('\n.sky-legend {')));
  assert.ok(!/position:\s*absolute/.test(rule), 'windowed it is in flow, under the picture');
  assert.match(rule, /margin: 0\.5rem 0 0/, 'a gap under the picture');
  // And it must be outside the box the on-map controls are positioned
  // against, or it makes that box taller and they follow it down onto the key.
  const stage = html.indexOf('<div class="sky-stage">');
  const caption = html.indexOf('<figcaption class="caption" id="liveSkyDesc">');
  const key = html.indexOf('id="skyLegend"');
  assert.ok(key > stage, 'still inside the figure');
  assert.ok(key < caption, 'above the caption');
  const stageEnd = html.lastIndexOf('</div>', key);
  assert.ok(stageEnd > stage && stageEnd < key,
    'the picture box must close before the key opens');
});

test('full screen puts the key back on the picture, in the free corner', () => {
  // There the picture IS the screen and the corner has room for it.
  const plate = css.slice(css.indexOf('.live-sky.full .sky-legend {'),
    css.indexOf('}', css.indexOf('.live-sky.full .sky-legend {')));
  assert.match(plate, /position: absolute/);
  assert.match(plate, /top:/, 'the key belongs in the top corner');
  assert.match(plate, /right:/, 'the key belongs in the RIGHT corner');
  // Bottom right is the fill-the-screen button and the zoom; bottom left is
  // the pad; bottom centre is the mode button. Top right is the free corner.
  assert.ok(!/bottom:/.test(plate), 'the bottom corners are already taken');
  assert.match(plate, /background: rgba\(10, 14, 24, 0\.72\)/, 'a plate, so it reads over stars');
});

test('a row appears only when its path is actually drawn', () => {
  // A key to a line that is not on the map sends someone hunting the sky for
  // something that was never there.
  // To the end of the function, not a fixed 900 characters: a comment added
  // above the last line pushed it out of the window and this failed against
  // correct code.
  const start = appJs.indexOf('function updateLegend()');
  const fn = appJs.slice(start, appJs.indexOf('\n}', start));
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
  // Same trap on the way in: the station's path is built there too. Both the
  // button and the automatic load go through loadIss, so it is the one place
  // that has to rebuild.
  const load = appJs.slice(appJs.indexOf('async function loadIss('),
    appJs.indexOf('async function autoLoadIss('));
  assert.match(load, /refreshSkyVectors\(\)/,
    'fetching the station must rebuild its path, or the key gains a row '
    + 'before the line it refers to appears');
  assert.match(load, /updateLegend\(\)/,
    'and the key has to be told, or the row never appears at all');
});

// --- the station is there without being asked for -----------------------------
//
// Reported: "The ISS tracking never showed up in the legend until I enabled
// Look for ISS. It should always be there." It was behind the button alone,
// so its path was missing from the map and its row missing from the key until
// someone thought to press it -- and nothing on screen said the feature
// existed at all.
//
// It is the one thing up there that cannot be computed on the device: there
// is no orbit bundled with the app to propagate. So fetching it is the app's
// ONLY unprompted call to anyone else's server, and that carries obligations.

test('the station is fetched when the sky opens, once', () => {
  assert.match(appJs, /async function autoLoadIss\(\)/, 'the auto load is gone');
  const fn = appJs.slice(appJs.indexOf('async function autoLoadIss()'),
    appJs.indexOf("$('issBtn').onclick"));
  assert.match(fn, /if \(issAutoTried \|\| issOn \|\| !site\) return;/,
    'it must run once, and not at all before there is a position to use');
  assert.match(fn, /issAutoTried = true;/);
  // Hooked to the sky opening, not to load: the align half of the app has no
  // use for it and should not be reaching out on anyone's behalf.
  const open = appJs.slice(appJs.indexOf('seedOrientation();'),
    appJs.indexOf('seedOrientation();') + 900);
  assert.match(open, /autoLoadIss\(\)/, 'opening the sky must trigger it');
});

test('it fails silently, because a dark field has no signal', () => {
  // The condition this app is built for. A missing station is not an error
  // worth a sentence, and certainly not one worth a banner over the sky.
  const fn = appJs.slice(appJs.indexOf('async function autoLoadIss()'),
    appJs.indexOf("$('issBtn').onclick"));
  assert.match(fn, /catch \{[^}]*\}/,
    'the automatic load must swallow its own failure');
  assert.ok(!/issOut/.test(fn),
    'the automatic load must not write a status line; the button owns that');
});

test('arriving by itself does not point the ring at it', () => {
  // Pressing the button means "show me where it is" and takes the ring and
  // the arrow along. The app quietly loading the orbit is not that request,
  // and hijacking the view because a fetch came back would be the sky moving
  // under someone who did not ask.
  const auto = appJs.slice(appJs.indexOf('async function autoLoadIss()'),
    appJs.indexOf("$('issBtn').onclick"));
  assert.ok(!/guideTarget/.test(auto),
    'the automatic load must not retarget the ring');
  const load = appJs.slice(appJs.indexOf('async function loadIss('),
    appJs.indexOf('async function autoLoadIss('));
  assert.ok(!/guideTarget/.test(load),
    'retargeting belongs to the button, not to the shared loader');
  const btn = appJs.slice(appJs.indexOf("$('issBtn').onclick"),
    appJs.indexOf("$('skyConst').onclick"));
  assert.match(btn, /guideTarget = 'iss'/, 'the button must still retarget');
});

test('the app still tells the truth about what leaves the device', () => {
  // Two sentences became false the moment this fetch stopped being something
  // the user asked for. A privacy claim that is quietly out of date is worse
  // than one that was never made.
  assert.ok(!/Nothing else in this app touches the network\.<\/p>/.test(html),
    'the "nothing else touches the network" line is now untrue: the station '
    + 'is fetched without being asked');
  assert.match(html, /api\.wheretheiss\.at/,
    'the copy must name the third party it calls');
  assert.match(html, /timestamps and nothing about you/,
    'and say what is sent, since the point is that it is not the observer');
});
