import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A- AND A+ ARE THE ONE PAIR THAT MUST NEVER MOVE OR CHANGE SIZE.
//
// "The buttons to change the button size jump all over the place when
// enlarging, and possibly they should try to stay locked as well as they get
// bigger. I'm referring just to the A+ A- controls."
//
// Everything on this page is sized in rem, and rem here IS the setting: the
// root font-size is --base times --scale. So the two buttons that set it were
// sized by the number they change. A press resized the button under the
// finger, the wrapping header re-flowed around it, and the next press landed
// on empty space. For someone with limited mobility that is the worst target
// on the page -- and it is the one you reach for when the screen is already
// hard to use.
//
// evo.ablecamera reached the same rule from the same report (its #161):
// "the buttons should NOT get bigger and especially not smaller, one base
// locked size".
//
// Measured in a browser at 375x812, walking the whole ladder: one distinct
// box, 58x58 at (237, 10) and (302, 10), at every size. Before, five.

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');

/** The body of one CSS rule, by exact selector. */
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.notEqual(i, -1, `the rule "${selector}" is gone`);
  return css.slice(i, css.indexOf('}', i));
}

// --- the pair that must not move --------------------------------------------------------

test('the sizing pair is sized in px, not in the unit it changes', () => {
  // rem here IS the setting: the root font-size is --base times --scale. So
  // anything in rem grows when these are pressed, and these must not.
  assert.match(rule(':root'), /--base: 17px;/);
  assert.match(rule('html'), /font-size: calc\(var\(--base\) \* var\(--scale\)\)/);
  assert.match(rule(':root'), /--tap-lock: calc\(3\.4 \* var\(--base\)\)/,
    '--tap at the normal setting, and it stays there');
  const pair = rule('.sizing .icon-btn');
  assert.match(pair, /min-width: var\(--tap-lock\)/);
  assert.match(pair, /min-height: var\(--tap-lock\)/);
  assert.match(pair, /font-size: var\(--base\)/, 'the label must not grow either');
  assert.doesNotMatch(pair, /rem/, 'not one length in rem, or it moves with the setting');
  // The general rule still uses --tap: every OTHER button grows, which is the
  // point of the setting. This pair is the single exception.
  assert.match(rule('.icon-btn'), /min-width: var\(--tap\)/);
  // And the override has to come after the rule it overrides.
  assert.ok(css.indexOf('.sizing .icon-btn {') > css.indexOf('.icon-btn {'),
    'the locked size must win, so it must be written after the general one');
});

test('the pair has a column of its own, anchored to the top-right corner', () => {
  const bar = rule('.bar');
  assert.match(bar, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(bar, /"brand\s+sizing"/);
  assert.match(bar, /"actions\s+sizing"/);
  const sizing = rule('.sizing');
  assert.match(sizing, /grid-area: sizing/);
  assert.match(sizing, /align-self: start/, 'the top of the bar, so a taller bar moves nothing');
  assert.match(sizing, /flex: 0 0 auto/);
  assert.match(sizing, /gap: calc\(0\.4 \* var\(--base\)\)/, 'the gap between them is fixed too');
});

test('the pair is out of the wrapping row it used to shift around in', () => {
  const actions = html.slice(html.indexOf('<div class="bar-actions">'),
    html.indexOf('</div>', html.indexOf('<div class="bar-actions">')));
  for (const id of ['textSmaller', 'textBigger']) {
    assert.ok(!actions.includes(id), `#${id} must not be in the wrapping row`);
  }
  const sizing = html.slice(html.indexOf('<div class="sizing">'),
    html.indexOf('</div>', html.indexOf('<div class="sizing">')));
  assert.ok(sizing.includes('id="textSmaller"') && sizing.includes('id="textBigger"'));
  assert.ok(sizing.indexOf('textSmaller') < sizing.indexOf('textBigger'),
    'smaller then bigger, the order they have always been read in');
  // Still labelled with the action, like every other button here.
  assert.match(html, /id="textSmaller"[^>]*aria-label="Make the text smaller"/);
  assert.match(html, /id="textBigger"[^>]*aria-label="Make the text bigger"/);
});
