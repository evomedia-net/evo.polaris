import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// NIGHT MODE REPAINTS THE PICTURE, NOT ONLY THE CHROME.
//
// "entering/exiting night mode don't initially update sky map. any minor
// change/tap fixes it." The toggle set data-night on the root, which restyles
// every control and plate at once through CSS -- and the canvases, which are
// painted by script with `night` in hand, were left as they were until the
// next thing that happened to redraw them. A red star field under day
// chrome, a day star field under red chrome.

const appJs = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

const appearance = () => {
  const at = appJs.indexOf('function applyAppearance() {');
  assert.notEqual(at, -1, 'applyAppearance is gone');
  return appJs.slice(at, appJs.indexOf('\n}', at));
};

test('a change of appearance repaints the alignment pane and the live sky', () => {
  const a = appearance();
  // render() redraws the chart, the reticle and the Moon disc with the new
  // palette, and returns early with no site. It was already here.
  assert.match(a, /\n  render\(\);/, 'the alignment pane must repaint');
  // The sky view was not. Sized as well as drawn: a text-size change moves
  // the canvas's box without a resize event.
  const afterRender = a.slice(a.indexOf('render();'));
  assert.match(afterRender, /if \(skyOn\) \{ sizeSkyCanvas\(\); drawLiveSky\(\); \}/,
    'the sky view must repaint in the same press');
});

test('the night toggle goes through applyAppearance, so it gets the repaint', () => {
  assert.match(appJs, /\$\('nightToggle'\)\.onclick = \(\) => \{\s*night = !night; store\.set\('night', night\); applyAppearance\(\);/);
});

test('every drawing takes `night` from the same flag the toggle flips', () => {
  // The repaint only helps if the drawings read the flag rather than the
  // attribute. All four do.
  for (const fn of ['drawReticle(', 'drawSkyChart(', 'drawMoonDisc(', 'drawSkyView(']) {
    const at = appJs.indexOf(fn);
    assert.notEqual(at, -1, `${fn} is gone`);
    const call = appJs.slice(at, appJs.indexOf('});', at));
    assert.match(call, /\bnight\b/, `${fn} must be handed the night flag`);
  }
});
