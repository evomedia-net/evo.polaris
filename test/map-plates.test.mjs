// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THREE PLATES CANNOT SHARE A 270x180 BOX.
//
// "When I make the buttons really large, the screen starts to overlap."
//
// The windowed canvas is 3:2, so on a 375px phone it is about 270x180. Over
// it sat the key (top right), the Az/Alt readout (bottom centre) and Fill the
// screen (bottom right). The key alone is six rows of text -- 167x149 at the
// normal size and 268x238 at the largest, taller than the canvas -- so the
// three overlapped at EVERY size, the default included. Raising the text only
// made a standing bug obvious.
//
// Measured on a 375x812 phone, before:
//
//     size   key x readout   key x Fill   readout x Fill
//     1.0    64x19           68x32        -
//     1.3    102x70          88x88        8x70
//     1.6    125x86          109x109      53x86
//
// After: nothing on the windowed map is over anything else at any size.
//
// The fix is arithmetic, not taste. No cap on the text makes six rows of type
// fit beside two other plates in 180px of height, so the key leaves the
// picture in the windowed view and the readout takes the far corner from Fill
// the screen. Full screen keeps both on the picture, because there the
// picture is the whole screen.

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');

const block = (sel) => {
  const i = css.indexOf(`${sel} {`);
  assert.notEqual(i, -1, `${sel} is gone from style.css`);
  return css.slice(i, css.indexOf('}', i));
};

test('the windowed map has one plate in each bottom corner, and none in the middle', () => {
  // Bottom left the numbers, bottom right the way in. Centred, the numbers
  // ran into the button: 53px of overlap at the largest size.
  assert.match(block('.live-sky:not(.full) .sky-readout'),
    /left: max\(0\.6rem, env\(safe-area-inset-left\)\)/);
  assert.match(block('.live-sky:not(.full) .sky-readout'), /transform: none/);
  assert.match(block('.map-full'), /right: max\(0\.6rem, env\(safe-area-inset-right\)\)/);
  assert.match(block('.map-full'), /bottom: max\(0\.6rem, env\(safe-area-inset-bottom\)\)/);
});

test('the key is not a plate on the windowed map at all', () => {
  const key = css.slice(css.indexOf('\n.sky-legend {'),
    css.indexOf('}', css.indexOf('\n.sky-legend {')));
  assert.ok(!/position:\s*absolute/.test(key));
  assert.ok(!/background:\s*rgba/.test(key), 'no plate behind it: it is text under a figure');
  // And it keeps the credits, which is the whole reason it is moved rather
  // than dropped. ESO's terms: the credit "cannot be hidden or separated from
  // the image" -- directly under the picture, in the same figure, is neither.
  for (const id of ['legMilky', 'legPlanetArt', 'legFigures']) {
    assert.ok(html.includes(`id="${id}"`), `the ${id} credit must survive the move`);
  }
  assert.match(html, /Milky Way: ESO\/S\.&nbsp;Brunier/, 'wording unaltered, as the terms require');
});

test('the key sits outside the box the on-map controls are measured from', () => {
  // The load-bearing half. Left in flow INSIDE .sky-stage, the key made that
  // box taller -- and the readout and Fill the screen are positioned against
  // it, so they followed the box down and landed on the key. Measured: the
  // overlap did not go away until the element moved out.
  const stage = html.indexOf('<div class="sky-stage">');
  const key = html.indexOf('id="skyLegend"');
  const caption = html.indexOf('<figcaption class="caption" id="liveSkyDesc">');
  assert.ok(stage !== -1 && key !== -1 && caption !== -1);
  assert.ok(html.lastIndexOf('</div>', key) > stage,
    'the picture box must close before the key opens');
  assert.ok(key < caption, 'and the key still belongs to the figure');
  assert.match(block('.sky-stage'), /position: relative/,
    'the box the controls are measured from');
});

test('full screen still has the key on the picture', () => {
  const plate = block('.live-sky.full .sky-legend');
  assert.match(plate, /position: absolute/);
  assert.match(plate, /background: rgba\(10, 14, 24, 0\.72\)/);
  // It is positioned against .live-sky.full, which is fixed to the viewport;
  // the picture box fills that same box, so this is the corner it always was.
  assert.match(block('.live-sky.full'), /position: fixed/);
  assert.match(block('.live-sky.full'), /inset: 0/);
});
