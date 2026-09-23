import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// HOW FAR THE VIEW ZOOMS, IN THE UNITS IT WAS TESTED IN.
//
// "+2 = pressing + button twice from full zoom in." Every limit here is a
// number of presses outward from the tightest field, five degrees a press,
// so the constants read the way the values were chosen on a phone in the
// field rather than as degrees someone has to convert.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

test('the view opens at +2, two presses out from full zoom-in', () => {
  assert.match(appJs, /^const FOV_MIN = 10, FOV_STEP = 5;$/m);
  assert.match(appJs, /^const FOV_START = FOV_MIN \+ 2 \* FOV_STEP;/m);
  assert.match(appJs, /^let skyFov = FOV_START;$/m, 'and that is where it starts');
});

test('never wider than +7, with or without the art', () => {
  // "it distorts so much there should be a limit with or without art."
  // It went to 170 degrees.
  assert.match(appJs, /^const FOV_MAX = FOV_MIN \+ 7 \* FOV_STEP;/m);
  assert.doesNotMatch(appJs, /FOV_MAX = 170/, 'the old limit is gone');
});

test('with the art on, on a phone, never wider than +4', () => {
  // The art is what costs a phone its frame rate, and a desktop draws the
  // same frame hundreds of times a second -- so the tighter limit needs both.
  assert.match(appJs, /^const FOV_MAX_ART_PHONE = FOV_MIN \+ 4 \* FOV_STEP;/m);
  assert.match(appJs, /matchMedia\('\(pointer: coarse\)'\)\.matches/,
    'a phone is a finger for a primary pointer, not a narrow window');
  const fn = appJs.slice(appJs.indexOf('function maxFov()'), appJs.indexOf("$('skyWider').onclick"));
  assert.match(fn, /return skyFigures && COARSE_POINTER \? FOV_MAX_ART_PHONE : FOV_MAX;/);
});

test('zooming out stops at the limit that applies now', () => {
  const wider = appJs.slice(appJs.indexOf("$('skyWider').onclick"), appJs.indexOf("$('skyNarrower').onclick"));
  assert.match(wider, /skyFov = Math\.min\(maxFov\(\), skyFov \+ FOV_STEP\);/);
  // The full-screen button is the same action, so it obeys the same limit.
  assert.match(appJs, /\$\('fullOut'\)\.onclick = \(\) => \$\('skyWider'\)\.click\(\);/);
});

test('turning the art on brings a wider view in to meet the tighter limit', () => {
  const toggle = appJs.slice(appJs.indexOf("$('skyFigures').onclick"), appJs.indexOf("$('skyMilky').onclick"));
  assert.match(toggle, /skyFov = Math\.min\(skyFov, maxFov\(\)\);/);
  assert.ok(toggle.indexOf('Math.min(skyFov, maxFov())') < toggle.indexOf('drawLiveSky()'),
    'before the redraw, so the frame drawn is already inside the limit');
});

test('the limits are ordered the way they read', () => {
  // Evaluated from the source rather than trusted from a comment.
  const num = (name) => {
    const m = appJs.match(new RegExp(`const ${name} = FOV_MIN \\+ (\\d+) \\* FOV_STEP`));
    return 10 + Number(m[1]) * 5;
  };
  const start = num('FOV_START'), phone = num('FOV_MAX_ART_PHONE'), max = num('FOV_MAX');
  assert.equal(start, 20);
  assert.equal(phone, 30);
  assert.equal(max, 45);
  assert.ok(10 < start && start <= phone && phone <= max, `${start} / ${phone} / ${max}`);
});

test('a zoom button with nowhere to go looks spent, in both places', () => {
  // "at zoom 1 disable [-] button, at zoom +7 disable [+] button": the
  // buttons that would cross a limit grey out. The app's + zooms in, so at
  // the tightest field it is the zoom-in pair, and at the widest the zoom-out.
  const fn = appJs.slice(appJs.indexOf('function updateZoomButtons()'), appJs.indexOf("$('skyWider').onclick"));
  assert.match(fn, /const atMin = skyFov <= FOV_MIN;/);
  assert.match(fn, /const atMax = skyFov >= maxFov\(\);/, 'the widest limit that applies now, art and all');
  assert.match(fn, /for \(const id of \['fullIn', 'skyNarrower'\]\)/);
  assert.match(fn, /for \(const id of \['fullOut', 'skyWider'\]\)/);
  // aria-disabled, not disabled: a disabled button drops out of the tab
  // order and a keyboard user reaching the limit loses their place.
  assert.match(fn, /setAttribute\('aria-disabled', atMin \? 'true' : 'false'\)/);
  assert.match(fn, /setAttribute\('aria-disabled', atMax \? 'true' : 'false'\)/);
  assert.doesNotMatch(fn, /\.disabled = /);
});

test('the buttons are brought up to date wherever the field or its limit changes', () => {
  const wider = appJs.slice(appJs.indexOf("$('skyWider').onclick"), appJs.indexOf("$('skyNarrower').onclick"));
  const narrower = appJs.slice(appJs.indexOf("$('skyNarrower').onclick"), appJs.indexOf("$('fullIn').onclick"));
  const toggle = appJs.slice(appJs.indexOf("$('skyFigures').onclick"), appJs.indexOf("$('skyMilky').onclick"));
  for (const [name, block] of [['zoom out', wider], ['zoom in', narrower], ['the art switch', toggle]]) {
    assert.match(block, /updateZoomButtons\(\);/, `${name} must refresh the buttons`);
  }
  assert.match(appJs, /\nupdateZoomButtons\(\);\n/, 'and once at start, so the page opens in the right state');
});

test('a spent button looks spent, by day and in full screen', () => {
  const css = readFileSync(fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.big-btn\[aria-disabled='true'\]/);
  assert.match(css, /\.map-btn\[aria-disabled='true'\] \{ opacity: 0\.45; cursor: not-allowed; \}/);
});
