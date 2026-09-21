import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE HEADER MUST NOT MAKE THE PAGE WIDER THAN THE PHONE.
//
// Reported from a real iPhone: "page loads like this and won't scroll."
//
// Every control in the bar is sized in rem, so A+ grows the buttons along with
// the text. Four of them sat on one row that could not wrap, each holding a
// min-width of --tap, and past the default text size the row stopped fitting a
// phone -- it overflowed rather than wrapping. Measured at 375px wide:
//
//     scale 0.8 -> 375px   (fits)
//     scale 1.0 -> 382px   (7px over)
//     scale 1.3 -> 497px
//     scale 1.8 -> 688px   (83% wider than the glass)
//
// The viewport meta is width=device-width, initial-scale=1, so Safari does not
// shrink that to fit -- it gives the page somewhere to go sideways, and iOS
// then spends vertical swipes panning horizontally. Hence "won't scroll": the
// page was not frozen, it was being dragged the other way.
//
// What makes it worth a test rather than a one-line fix is WHICH control broke
// it. The text-size buttons are the accessibility feature; they made the
// largest text the least usable setting, which is exactly backwards for an app
// whose promise is that it works for people who cannot crouch behind an
// eyepiece.

const root = new URL('../site/', import.meta.url);
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');

/** The body of one CSS rule, by selector. */
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.notEqual(i, -1, `the rule "${selector}" is gone`);
  return css.slice(i, css.indexOf('}', i));
}

test('the button row wraps instead of overflowing', () => {
  // The whole bug in one declaration. A row that cannot wrap and cannot shrink
  // below its min-width has only one thing left to do, and that is overflow.
  assert.match(rule('.bar-actions'), /flex-wrap:\s*wrap/,
    '.bar-actions must wrap — without it the buttons push the page sideways');
});

test('the bar itself wraps, so the actions can drop to their own row', () => {
  // Wrapping only the inner row is not enough: at large text the wordmark and
  // the actions together still exceed the width, and the actions need a line.
  assert.match(rule('.bar'), /flex-wrap:\s*wrap/,
    '.bar must wrap, or the actions have nowhere to go');
});

test('the touch targets are not shrunk to buy the space', () => {
  // The cheap fix is to let the buttons get smaller, and it is the wrong one:
  // these are pressed outdoors, in the dark, with an unsteady hand or a
  // mouthstick. --tap stays; the row wraps instead.
  assert.match(rule('.icon-btn'), /min-width:\s*var\(--tap\)/,
    'icon buttons must keep their --tap width — wrap the row, do not shrink it');
  assert.match(rule('.icon-btn'), /min-height:\s*var\(--tap\)/,
    'icon buttons must keep their --tap height');
});

test('a wrapped header does not stay pinned over a short screen', () => {
  // The other half. Wrapping trades width for height, and at 1.8x the bar is
  // around 60% of a short viewport -- a phone on a call is a short viewport,
  // because the in-call banner takes a slice off the top. A sticky bar that
  // size leaves a sliver to read the app through, which reads as "won't
  // scroll" just as surely as the overflow did.
  assert.match(css, /\.bar\.unpinned\s*\{[^}]*position:\s*static/,
    '.bar.unpinned must drop the sticky positioning');
  assert.ok(appJs.includes('function pinHeader'),
    'pinHeader (which measures the bar against the viewport) is gone');
  assert.match(appJs, /bar\.classList\.toggle\('unpinned'/,
    'pinHeader must be what toggles the class');
  // It has to be re-measured when the text scale changes and when the viewport
  // does -- a rotation changes innerHeight without touching the scale.
  assert.match(appJs, /pinHeader\(\);\s*\n\s*render\(\);/,
    'applyAppearance must re-measure the header when the text size changes');
  assert.match(appJs, /addEventListener\('resize',\s*pinHeader\)/,
    'the header must be re-measured on resize');
  assert.match(appJs, /addEventListener\('orientationchange',\s*pinHeader\)/,
    'the header must be re-measured on rotation');
});

test('the measurement is taken unpinned', () => {
  // Measuring while the class is applied measures the state being decided, and
  // the bar then latches: once unpinned it reports a height that keeps it
  // unpinned. Clear first, then measure.
  const fn = appJs.slice(appJs.indexOf('function pinHeader'),
    appJs.indexOf('function pinHeader') + 600);
  const clear = fn.indexOf("classList.remove('unpinned')");
  const measure = fn.indexOf('getBoundingClientRect');
  assert.notEqual(clear, -1, 'pinHeader must clear the class before measuring');
  assert.ok(clear < measure,
    'the class must be cleared BEFORE the height is read, or the bar latches');
});
