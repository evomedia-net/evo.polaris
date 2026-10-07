// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

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

// NIGHT MODE MUST NOT BREAK FULL SCREEN.
//
// Dimming used to be `filter: brightness(0.7)` on body. A filter makes its
// element the CONTAINING BLOCK for every position:fixed descendant, so in
// Night Mode "fixed" meant "relative to body" -- as tall as the document.
// The full-screen overlay sized itself to the document (a 780x7613 backing
// store on a 390x844 phone) and the Auto/Manual button sat thousands of
// pixels below the fold, where it could not be found at all. See #64.

const css = readFileSync(
  fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');

test('nothing that contains the full-screen view carries a filter', () => {
  // body and html are both ancestors of the overlay AND of the fixed
  // Auto/Manual button, so a filter on either breaks both.
  const offenders = css.split('\n').filter((l) =>
    /^html\[data-night='on'\]\s+body\s*\{[^}]*filter:/.test(l)
    || /^html\[data-night='on'\]\s*\{[^}]*filter:/.test(l));
  assert.deepEqual(offenders, [],
    'a filter on html or body makes it the containing block for '
    + 'position:fixed, which is what hid the Auto/Manual button');
});

test('it dims with a veil instead, and the veil cannot be pressed', () => {
  const i = css.indexOf("html[data-night='on'] body::after");
  assert.notEqual(i, -1, 'the night veil is gone; the screen is undimmed');
  const rule = css.slice(i, css.indexOf('}', i));
  assert.match(rule, /position:\s*fixed/, 'the veil must cover the screen');
  assert.match(rule, /inset:\s*0/);
  assert.match(rule, /pointer-events:\s*none/,
    'a veil over the whole screen that can take a press is a worse bug '
    + 'than the one it fixed');
  // 30% black over pure red reproduces brightness(0.7) exactly: 255 x 0.7 and
  // 255 x (1 - 0.3) are both 178.5.
  assert.match(rule, /opacity:\s*0\.3/,
    'the veil must dim by the same amount the filter did');
});
