// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE PHOTO CREDITS ARE READABLE AT NIGHT (#232).
//
// Drawn at 85% so they sit behind the key, they were #d90000 on black in Night
// Mode: 3.93:1 by axe-core, under WCAG 1.4.3's 4.5:1. WCAG Mode fixed it for
// itself; this is the same fix for the default mode. Full pure red is 5.25:1.

const css = readFileSync(fileURLToPath(new URL('../site/src/style.css', import.meta.url)), 'utf8');

/** The relative luminance of an sRGB channel triple, per WCAG. */
const lum = ([r, g, b]) => [r, g, b]
  .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('in Night Mode the credits are drawn at full ink', () => {
  assert.match(css, /html\[data-night='on'\] \.leg-credit,\s*html\[data-night='on'\] \.milky-credit \{ opacity: 1; \}/);
});

test('and that is the difference between failing and passing 4.5:1', () => {
  const black = [0, 0, 0];
  assert.ok(ratio([255 * 0.85, 0, 0], black) < 4.5, '85% red was the failure');
  assert.ok(ratio([255, 0, 0], black) >= 4.5, 'full red passes');
});
