// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pinchFov, wheelFov } from '../site/src/motion.js';

// PINCH TO ZOOM (#289). "it should support pinch zoom +/-" -- "it's common
// muscle memory". Two fingers zoom the sky; a trackpad pinch (Ctrl + wheel)
// does too, and in full screen so does the wheel. The buttons stay.

const appJs = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('fingers twice as far apart halve the field, from where the pinch began', () => {
  assert.ok(close(pinchFov(20, 100, 200, 10, 45), 10));
  assert.ok(close(pinchFov(20, 200, 100, 10, 45), 40));
  assert.ok(close(pinchFov(20, 150, 150, 10, 45), 20), 'no change while the spread holds');
  // The limits the buttons keep, including the deeper floor on a framed galaxy.
  assert.equal(pinchFov(20, 100, 1000, 10, 45), 10);
  assert.equal(pinchFov(20, 1000, 100, 10, 45), 45);
  assert.ok(close(pinchFov(1, 100, 300, 0.25, 45), 1 / 3), 'below +0 when the floor allows it');
  // Two fingers on the same pixel cannot divide by nothing.
  assert.equal(pinchFov(20, 0, 50, 10, 45), 20);
  assert.equal(pinchFov(20, 50, 0, 10, 45), 20);
});

test('the wheel zooms by steps: down widens, up narrows, one notch never leaps', () => {
  assert.ok(wheelFov(20, 100, 0, false, 10, 45) > 20, 'down widens, as in every map');
  assert.ok(wheelFov(20, -100, 0, false, 10, 45) < 20);
  // A mouse notch is capped to a step of about x1.2; with Ctrl, x1.65.
  assert.ok(close(wheelFov(20, 100, 0, false, 1, 90), 20 * Math.exp(0.2)));
  assert.ok(close(wheelFov(20, 100, 0, true, 1, 90), 20 * Math.exp(0.5)));
  assert.ok(close(wheelFov(20, 10000, 0, false, 1, 90), wheelFov(20, 100, 0, false, 1, 90)), 'capped');
  // A trackpad pinch's small deltas glide.
  assert.ok(Math.abs(wheelFov(20, -3, 0, true, 1, 90) - 20) < 1);
  // Line and page delta modes count as pixels.
  assert.ok(close(wheelFov(20, 3, 1, false, 1, 90), 20 * Math.exp(48 * 0.004)));
  assert.equal(wheelFov(44, 100, 0, true, 10, 45), 45);
  assert.equal(wheelFov(11, -100, 0, true, 10, 45), 10);
});

test('a pinch happens only where the sky owns the touch, and cancels the drag', () => {
  const at = appJs.indexOf('// --- pinching the sky (#289)');
  assert.ok(at > appJs.indexOf("$('liveSky').addEventListener('pointerdown'"),
    'after the drag listener, so a second finger cancels the drag it just started');
  const block = appJs.slice(at, appJs.indexOf('}, { passive: false });', at));
  assert.match(block, /getComputedStyle\(\$\('liveSky'\)\)\.touchAction === 'none'/,
    'the same rule as the stylesheet: full screen, or steering by hand');
  assert.match(block, /if \(touches\.size === 2 && skyOwnsTouch\(\)\) \{\s*drag = null;/);
  assert.match(block, /skyFov = pinchFov\(pinch\.fov0, pinch\.d0, spread\(\), minFov\(\), maxFov\(\)\);/);
  assert.match(block, /updateZoomButtons\(\);\s*drawLiveSky\(\);/);
  assert.match(block, /if \(e\.pointerType === 'mouse'\) return;/, 'a mouse is not a finger');
});

test('a trackpad pinch zooms anywhere on the sky; a plain wheel only in full screen', () => {
  const at = appJs.indexOf("$('liveSky').addEventListener('wheel'");
  assert.ok(at > 0, 'no wheel listener');
  const block = appJs.slice(at, appJs.indexOf('}, { passive: false });', at));
  assert.match(block, /if \(!e\.ctrlKey && !document\.querySelector\('\.live-sky\.full'\)\) return;/,
    'windowed, a plain wheel scrolls the page');
  assert.match(block, /e\.preventDefault\(\);/, 'or the browser zooms the whole page too');
  assert.match(block, /wheelFov\(skyFov, e\.deltaY, e\.deltaMode, e\.ctrlKey, minFov\(\), maxFov\(\)\)/);
});
