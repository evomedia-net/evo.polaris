import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nextStop } from '../site/src/walk.js';

// ONLY WHAT IS UP, WHEN WALKING.
//
// Found in the field: "When jumping through the constellations and the
// planets ... it would be really nice if we had the ability to only show
// things that are visible in the night sky with a toggle." Then, narrowing
// it: "They can all be shown below the horizon, but they shouldn't be
// selected if cycling through them. And that doesn't apply to the moon or
// the sun." -- "This should not apply to ISS." -- "This is only for planets
// and constellations."
//
// So it is a switch on the two walks and nothing else. The map still draws
// everything under the wireframe ground, and a press on the Moon, the Sun,
// the ISS or the pole still goes exactly where it went.

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');
const sw = readFileSync(fileURLToPath(new URL('sw.js', root)), 'utf8');

/** Walk `presses` times from the start, returning the stops landed on. */
function walk(count, up, presses) {
  const seen = [];
  let step = -1;
  for (let i = 0; i < presses; i++) {
    step = nextStop(step, count, (s) => up.includes(s));
    seen.push(step);
  }
  return seen;
}

// --- the walk ------------------------------------------------------------------------

test('with everything up, the walk is the list, then nothing, then round again', () => {
  // The walk as it always was: 0..3, then 4 (nothing), then 0 again.
  assert.deepEqual(walk(4, [0, 1, 2, 3], 7), [0, 1, 2, 3, 4, 0, 1]);
});

test('a stop that is down is stepped over', () => {
  // Mercury and Mars down, Venus and Jupiter up: Venus, Jupiter, nothing.
  assert.deepEqual(walk(4, [1, 3], 5), [1, 3, 4, 1, 3]);
});

test('the first press lands on the first stop that is up, not the first stop', () => {
  assert.deepEqual(walk(8, [5], 1), [5]);
});

test('"nothing" is never skipped, so a walk with nothing up can still let go', () => {
  // With every stop down the walk has one place to go, and it goes there
  // rather than round for ever.
  assert.deepEqual(walk(8, [], 3), [8, 8, 8]);
  // And from nothing, round to the first that is up.
  assert.equal(nextStop(8, 8, (s) => s === 2), 2);
});

test('a walk that has started resumes after where it is, skipping the same way', () => {
  assert.equal(nextStop(1, 5, (s) => s === 0 || s === 4), 4);
  assert.equal(nextStop(4, 5, (s) => s === 0 || s === 4), 5, 'then nothing');
  assert.equal(nextStop(5, 5, (s) => s === 0 || s === 4), 0, 'then round');
});

// --- the switch -------------------------------------------------------------------

test('the switch is off by default and remembered', () => {
  assert.match(appJs, /let skyUpOnly = store\.get\('uponly', false\);/);
  const h = appJs.slice(appJs.indexOf("$('tgtUpOnly').onclick"),
    appJs.indexOf('// The sky turns a quarter'));
  assert.match(h, /skyUpOnly = !skyUpOnly;/);
  assert.match(h, /store\.set\('uponly', skyUpOnly\);/);
  assert.match(h, /applyUpOnlyLabel\(\);/, 'the label follows the state');
  assert.match(h, /updateSkipButtons\(\);/, 'and so does which walk is spent');
});

test('it lives in the Track list, after the two walks it changes', () => {
  const grid = html.slice(html.indexOf('id="targetGrid"'), html.indexOf('</div>', html.indexOf('id="targetGrid"')));
  assert.ok(grid.includes('id="tgtUpOnly"'), 'it rolls up with the targets');
  assert.ok(grid.indexOf('id="tgtConst"') < grid.indexOf('id="tgtUpOnly"'),
    'under Planets and Constellations');
  assert.match(html, /id="tgtUpOnly" class="map-btn tgt-btn tgt-filter"\s+aria-label="Skip planets and constellations below the horizon">Skip what is down</);
  assert.ok(!/id="tgtUpOnly"[^>]*aria-pressed/.test(html),
    'an action, labelled with what pressing does -- not a value picker');
  assert.match(css, /\.live-sky\.full \.tgt-filter \{/);
});

// --- only the walks ----------------------------------------------------------------

test('both walks skip what is down when the switch is on, and only then', () => {
  const planets = appJs.slice(appJs.indexOf("$('tgtPlanets').onclick"), appJs.indexOf("$('tgtConst').onclick"));
  assert.match(planets, /planetStep = nextStop\(planetStep, PLANET_NAMES\.length,\s+\(i\) => !skyUpOnly \|\| stopIsUp\(PLANET_NAMES\[i\]\)\);/);
  const consts = appJs.slice(appJs.indexOf("$('tgtConst').onclick"), appJs.indexOf('// THE SWITCH.'));
  assert.match(consts, /constStep = nextStop\(constStep, CONST_KEYS\.length,\s+\(i\) => !skyUpOnly \|\| stopIsUp\(CONST_TARGETS\[i\]\)\);/);
  assert.match(appJs, /const CONST_TARGETS = CONST_KEYS\.map\(\(k\) => 'const:' \+ k\);/,
    'the targets the walk lands on, from the one list');
});

test('"down" is the caption\'s own rule, asked about the stop before landing', () => {
  const fn = appJs.slice(appJs.indexOf('function stopIsUp('), appJs.indexOf('function walkIsSpent('));
  assert.match(fn, /const t = aimTarget\(null, what\);/, 'the position the ring would use');
  assert.match(fn, /return !!t && !targetIsBelow\(t, what\);/, 'and the rule its caption uses');
  assert.match(appJs, /function aimTarget\(issLook, what = guideTarget\)/);
  assert.match(appJs, /function targetIsBelow\(t, what = guideTarget\)/);
  assert.match(appJs, /function targetIsPainted\(t, what = guideTarget\)/);
});

test('the Moon, the Sun, the ISS and the pole are untouched', () => {
  // "that doesn't apply to the moon or the sun" / "should not apply to ISS".
  const others = appJs.slice(appJs.indexOf("$('tgtPole').onclick"), appJs.indexOf('// OUT FROM THE SUN'));
  assert.ok(others.length > 200, 'found the four handlers');
  assert.doesNotMatch(others, /skyUpOnly|stopIsUp|walkIsSpent|sayDown/);
  const spent = appJs.slice(appJs.indexOf('function updateSkipButtons('), appJs.indexOf('function sayDown('));
  assert.doesNotMatch(spent, /tgtMoon|tgtSun|tgtIss|tgtPole/,
    'only the two walk buttons can look spent');
});

test('nothing is hidden from the map', () => {
  // "They can all be shown below the horizon."
  const draw = appJs.slice(appJs.indexOf('function drawLiveSky('),
    appJs.indexOf('\n}', appJs.indexOf('function drawLiveSky(')));
  assert.doesNotMatch(draw, /skyUpOnly|stopIsUp/);
});

test('a walk with nothing up says so instead of moving the ring', () => {
  const planets = appJs.slice(appJs.indexOf("$('tgtPlanets').onclick"), appJs.indexOf("$('tgtConst').onclick"));
  assert.match(planets, /if \(walkIsSpent\(PLANET_NAMES\)\) \{ sayDown\('No planet is above the horizon right now\.'\); return; \}/);
  const consts = appJs.slice(appJs.indexOf("$('tgtConst').onclick"), appJs.indexOf('// THE SWITCH.'));
  assert.match(consts, /if \(walkIsSpent\(CONST_TARGETS\)\) \{ sayDown\('No constellation is above the horizon right now\.'\); return; \}/);
  const spentFn = appJs.slice(appJs.indexOf('function walkIsSpent('), appJs.indexOf('function updateSkipButtons('));
  assert.match(spentFn, /skyUpOnly && !targets\.includes\(guideTarget\)/,
    'mid-walk it is never spent: the next press is how the walk lets go');
  // The words go where a screen reader reads, ahead of anything else there.
  const mode = appJs.slice(appJs.indexOf('function updateSkyMode('), appJs.indexOf('if (following) {', appJs.indexOf('function updateSkyMode(')));
  assert.match(mode, /if \(targetNote\) \{/);
  assert.match(appJs, /targetNote = '';\n  updateTargetName\(\);/, 'and moving the ring clears them');
});

test('which walk is spent is worked out on the slow tick, never per frame', () => {
  // It asks where every constellation is. Per frame that is 26 map builds
  // sixty times a second, for a state that changes over minutes.
  const draw = appJs.slice(appJs.indexOf('function drawLiveSky('),
    appJs.indexOf('\n}', appJs.indexOf('function drawLiveSky(')));
  assert.doesNotMatch(draw, /updateSkipButtons/);
  const name = appJs.slice(appJs.indexOf('function updateTargetName('),
    appJs.indexOf('\n}', appJs.indexOf('function updateTargetName(')));
  assert.doesNotMatch(name, /updateSkipButtons/, 'updateTargetName runs every frame');
  const refresh = appJs.slice(appJs.indexOf('function refreshSkyVectors('),
    appJs.indexOf('// --- the paths they move along'));
  assert.match(refresh, /updateSkipButtons\(\);/);
  // aria-disabled, like the zoom buttons at their limits, so focus is kept.
  const fn = appJs.slice(appJs.indexOf('function updateSkipButtons('), appJs.indexOf('function sayDown('));
  assert.match(fn, /setAttribute\('aria-disabled', spent \? 'true' : 'false'\)/);
  assert.doesNotMatch(fn, /\.disabled = /);
});

test('the walk module is cached for offline use', () => {
  assert.match(sw, /'\.\/src\/walk\.js'/);
  assert.match(appJs, /import \{ nextStop \} from '\.\/walk\.js';/);
});
