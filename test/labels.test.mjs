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

/**
 * Value pickers: the label IS the value, and the selection is carried by
 * aria-pressed (hemispheres) or aria-selected (the two modes) rather than by
 * the words. The mode picker names the two jobs this app does, which is what a
 * picker is for; it is not a pair of actions.
 */
const VALUE_PICKERS = new Set([
  'latN', 'latS', 'lonE', 'lonW', 'modeSkyBtn', 'modeAlignBtn',
  // The full-screen target pickers. "Polaris", "ISS", "Moon", "Planets" name
  // the value -- which thing the ring is on -- in the same way "East" names a
  // hemisphere, and the selection is carried by aria-pressed. Writing them as
  // actions ("Point at the Moon") would be four verbs competing for a phone's
  // worth of space to say what the state already says.
  //
  // Planets is the odd one: it cycles rather than selects, so it also carries
  // an aria-label spelling out that a press moves to the next planet out.
  'tgtPole', 'tgtIss', 'tgtMoon', 'tgtSun', 'tgtPlanets', 'tgtConst',
]);

/** Glyph buttons. Their words live in aria-label, which is checked instead. */
const GLYPH_BUTTONS = new Set([
  'textSmaller', 'textBigger', 'fullIn', 'fullOut',
  'fullUp', 'fullDown', 'fullLeft', 'fullRight', 'fullPole',
]);

/**
 * The verbs this app's buttons actually start with. A closed list on purpose:
 * adding a verb should be a decision someone makes, not something that happens
 * because a label was written in a hurry.
 */
const VERBS = new Set([
  'use', 'turn', 'show', 'hide', 'enter', 'look', 'find', 'read', 'follow',
  'stop', 'make', 'switch', 'change', 'move', 'plan', 'fill', 'leave', 'set',
  // Added with the full-screen icon buttons, which say what they do in one
  // word under the glyph: Zoom in, Zoom out, Exit, Center, Horizon.
  'zoom', 'exit', 'center',
  // The roll-up over the target list: press it and you can track something.
  'track',
  // The switch in that list. "Skip what is down" / "Include what is down":
  // what the target buttons will do about anything below the horizon.
  'skip', 'include',
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

  const scan = (text, name) => {
    // Both the visible text AND the accessible name. Where a control's visible
    // word is shortened to fit a row, the aria-label is the real label, and a
    // test that only read textContent would be checking the abbreviation.
    for (const prop of ['\\.textContent\\s*=', "\\.setAttribute\\('aria-label',"]) {
      const re = new RegExp(`${name}${prop}([\\s\\S]*?);`, 'g');
      for (const m of text.matchAll(re)) {
        // Join string concatenations first. A sentence written as
        // `'Switch to ' + 'Dark Mode.'` is ONE label; read literal by literal
        // it looks like a second label starting with the word "Dark".
        const rhs = m[1].replace(/'\s*\+\s*'/g, '');
        for (const lit of rhs.matchAll(/'((?:[^'\\]|\\.)*)'/g)) out.push(lit[1]);
      }
    }
  };

  scan(src, `\\$\\('${id}'\\)`);

  // An alias is only live from where it is declared until the same name is
  // declared again. Collecting alias names globally and matching them across
  // the whole file was wrong the moment two functions both used `btn`: the
  // theme button was credited with the planning button's labels. Scoped.
  for (const a of src.matchAll(new RegExp(`const (\\w+) = \\$\\('${id}'\\)`, 'g'))) {
    const name = a[1];
    const from = a.index + a[0].length;
    const rest = src.slice(from);
    const next = rest.search(new RegExp(`const ${name} = \\$\\(`));
    scan(next === -1 ? rest : rest.slice(0, next), name);
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
    ['skyConst', 'Show the constellations', 'Hide the constellations'],
    ['skyMilky', 'Show the Milky Way', 'Hide the Milky Way'],
    ['skyPlanets', 'Show the planets', 'Hide the planets'],
    ['skyMoon', 'Show the Moon', 'Hide the Moon'],
    ['manualToggle', 'Enter it by hand instead', 'Hide the hand-entry boxes'],
    // "Exit" is the word written under the glyph, so the name contains it.
    ['fullBtn', 'Fill the screen', 'Exit full screen'],
    // Auto Mode is the phone steering, Manual Mode is the arrows. One
    // control, action-labelled -- it replaced two buttons whose names were
    // near-identical and meant entirely different things.
    // Short on the face, the whole phrase in the accessible name.
    ['modeBtn', 'Use Auto Mode', 'Use Manual Mode'],
    // Its visible word is short so it shares a row with the coordinates; the
    // accessible name is the full phrase, and that is the label under test.
    ['placeChange', 'Set your location', 'Hide the position boxes'],
    ['whenChange', 'Change the date', 'Hide the date boxes'],
    // Short on the face so it fits the target column; the accessible name
    // says what is being skipped.
    ['tgtUpOnly', 'Skip what is down', 'Include what is down'],
    ['tgtUpOnly', 'Skip planets and constellations below the horizon',
      'Include planets and constellations below the horizon'],
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

test('every element app.js reaches for exists in the page', () => {
  // The restructure that split the app into two panes moved almost every
  // element in the page. A single renamed or dropped id is a TypeError on the
  // first render, and the only place it shows up is a browser console.
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...new Set(
    [...appJs.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]),
  )];
  // Both sides are asserted non-empty first. A regex that silently matches
  // nothing would otherwise report "every id is missing", which reads as a
  // catastrophic page failure and is really a broken test.
  assert.ok(ids.size > 40, `only parsed ${ids.size} ids out of index.html`);
  assert.ok(wanted.length > 40, `only found ${wanted.length} lookups`);
  const missing = wanted.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [],
    `app.js reaches for ids that index.html does not have: ${missing.join(', ')}`);
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

test('the docs link hands the theme over, and points at the fleet docs host', () => {
  // Night Mode protects dark adaptation: twenty minutes to build, one bright
  // screen to lose. A docs link that opened a white page would undo the whole
  // point of the theme at the moment someone reached for help, outdoors, in
  // the dark. So the theme travels with the link.
  assert.match(html, /id="docsLink"[^>]*href="https:\/\/docs\.evomedia\.net\/polaris\/"/,
    'the docs link must point at docs.evomedia.net/<project>/, the fleet shape');
  assert.match(appJs, /docsLink'\)\.href = `\$\{DOCS_URL\}\?night=\$\{night \? 'on' : 'off'\}`/,
    'the docs link must carry the current theme, in both directions');
  // And it must be re-derived whenever the theme changes, not set once at
  // boot -- a link stamped at load says "night" all day after one toggle.
  const appearance = appJs.slice(appJs.indexOf('function applyAppearance'),
    appJs.indexOf('$(\'textBigger\')'));
  assert.ok(appearance.includes("$('docsLink').href"),
    'the href must be set inside applyAppearance, so it follows the toggle');
});
