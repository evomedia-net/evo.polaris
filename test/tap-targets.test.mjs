// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// NO ON-MAP CONTROL GOES UNDER THE TOUCH-TARGET MINIMUM.
//
// "I'm not sure why you made the decision to make the X button smaller on
// the screen, but that is a real problem for people with disabilities. It's
// difficult for me to press it each time."
//
// The full-screen exit button was 3.2rem -- under the app's own --tap
// minimum of 3.4rem -- and sat directly beneath three 4rem buttons, so the
// one control you press to leave full screen was the smallest thing on the
// screen. It had been that size since the day it was added; it just got more
// noticeable every time something bigger was put next to it. The app's
// accessibility promise is written in style.css as a number, and nothing was
// holding the controls to it.
//
// These read the stylesheet, because that is where the sizes are, and hold
// every on-map button to the minimum -- and the exit button to the same size
// as the column it shares a corner with.
//
// IN THE CONTROLS' OWN UNIT. Since #147 the full-screen controls are sized in
// --ctl, which is the text size until the phone runs out of room and never
// less than the root size at the normal setting. So "at least --tap" here
// means at least 3.4 of the normal-size rem -- the size the minimum was set
// at -- rather than 3.4 of whatever the text setting has grown rem to.

const css = readFileSync(
  fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');

/**
 * The `prop: calc(<n> * var(--ctl...))` value inside the first block whose
 * selector matches, in units of --ctl.
 */
function unitsOf(selector, prop) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} is gone from style.css`);
  const block = css.slice(start, css.indexOf('}', start));
  const m = block.match(new RegExp(`\\b${prop}:\\s*calc\\(([\\d.]+) \\* var\\(--ctl(?:, 1rem)?\\)\\)`));
  assert.ok(m, `${selector} has no ${prop} in --ctl`);
  return Number(m[1]);
}

const TAP = (() => {
  const m = css.match(/--tap:\s*([\d.]+)rem/);
  assert.ok(m, '--tap is gone from style.css');
  return Number(m[1]);
})();

test('the touch-target minimum is still a real number', () => {
  assert.ok(TAP >= 2.75, `--tap is ${TAP}rem, which is 44px at 16px -- the floor WCAG names`);
});

test('the controls\' unit is never below the normal-size rem', () => {
  // The floor that makes every comparison below mean something: whatever the
  // phone and the text setting, one --ctl is at least var(--base), the root
  // size at the normal setting.
  const m = css.match(/--ctl:\s*max\(var\(--base\),/);
  assert.ok(m, '--ctl must be floored at var(--base)');
  assert.match(css, /--base:\s*\d+px;\s*\/\* the root size at the normal setting \*\//);
});

test('the full-screen exit button is at least the minimum', () => {
  assert.ok(unitsOf('.map-full {', 'width') >= TAP, 'exit button narrower than --tap');
  assert.ok(unitsOf('.map-full {', 'height') >= TAP, 'exit button shorter than --tap');
});

test('and the same size as the zoom column it shares a corner with', () => {
  // One corner, one thumb, one size. A smaller button under bigger ones is
  // the one that gets missed.
  const exit = unitsOf('.map-full {', 'width');
  const zoom = unitsOf('.live-sky.full .map-zoom-btn {', 'width');
  assert.equal(exit, zoom, `exit ${exit} vs zoom ${zoom}`);
  assert.equal(unitsOf('.map-full {', 'height'), unitsOf('.live-sky.full .map-zoom-btn {', 'height'));
});

test('the zoom column clears the exit button with a gap', () => {
  // The column is anchored above the exit button by a fixed offset. If the
  // button grows and the offset does not, they overlap and the bottom zoom
  // button loses its lower edge to the exit.
  const start = css.indexOf('.live-sky.full .full-zoom {');
  const block = css.slice(start, css.indexOf('}', start));
  // `max(0.6rem, env(safe-area-inset-bottom))` nests parentheses, so the
  // offset is taken from the trailing `+ <n> * var(--ctl))` rather than by
  // matching the inside of max().
  const m = block.match(/bottom:\s*calc\(.*\+\s*([\d.]+) \* var\(--ctl\)\)/);
  assert.ok(m, 'the zoom column must be offset above the exit button');
  const offset = Number(m[1]);
  const exit = unitsOf('.map-full {', 'height');
  assert.ok(offset >= exit + 0.5, `column offset ${offset} leaves no gap above a ${exit} exit button`);
});

test('every full-screen pad and zoom button meets the minimum too', () => {
  for (const sel of ['.live-sky.full .map-zoom-btn {', '.live-sky.full .map-pan-btn {']) {
    assert.ok(unitsOf(sel, 'width') >= TAP, `${sel} narrower than --tap`);
    assert.ok(unitsOf(sel, 'height') >= TAP, `${sel} shorter than --tap`);
  }
});
