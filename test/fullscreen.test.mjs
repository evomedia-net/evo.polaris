import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Full screen must follow a ROTATION, never the load state.
//
// Shipped v0.0.0.1.1 filled the screen on load: the sky pane is the default,
// opening it called syncFullScreen(), and that read the current orientation --
// so every desktop (permanently landscape) and any phone loaded sideways went
// full screen the instant the page rendered. The feature was meant to react to
// turning the phone, which is a change; the orientation at load is not one.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');

test('opening the sky view does not enter full screen', () => {
  // The pane-open path seeds the orientation without acting on it. The old
  // syncFullScreen() -- which filled from the static state -- is gone.
  assert.ok(!/function syncFullScreen/.test(appJs),
    'syncFullScreen (the fill-from-static-state function) is back');
  const openBlock = appJs.slice(appJs.indexOf('if (sky) {'),
    appJs.indexOf('aimAtPole();'));
  assert.ok(openBlock.includes('seedOrientation()'),
    'pane-open must seed the orientation, not act on it');
  assert.ok(!openBlock.includes('applyFullScreen()'),
    'pane-open must not fill the screen');
});

test('a plain resize never changes the full-screen state', () => {
  // Only an orientation FLIP does. A resize that keeps the same orientation --
  // a desktop window drag, the mobile URL bar showing and hiding -- must only
  // re-size the canvas.
  const fn = appJs.slice(appJs.indexOf('function onViewportChanged'),
    appJs.indexOf("window.addEventListener('resize'"));
  assert.ok(fn.includes('now !== lastLandscape'),
    'the handler must gate on an orientation flip, not the current state');
  assert.ok(fn.includes('canAutoFull'),
    'auto full screen must be gated to devices that actually rotate');
});

test('a desktop can never auto-fill', () => {
  // canAutoFull requires a coarse pointer -- a touch device. A mouse desktop,
  // which is always landscape and the exact thing that broke, is excluded.
  // pointer: coarse appears in exactly one place: the canAutoFull declaration.
  assert.ok(appJs.includes('const canAutoFull'), 'canAutoFull is gone');
  assert.ok(appJs.includes('(pointer: coarse)'),
    'auto full screen must require a coarse-pointer (touch) device');
});
