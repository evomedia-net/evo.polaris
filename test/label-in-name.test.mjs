// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE SPOKEN NAME CONTAINS THE WORDS ON THE BUTTON (WCAG 2.5.3, LABEL IN NAME).
//
// A voice-control user says what they see -- "click Use Night Mode" -- and a
// screen-reader user hears the name with a sighted helper reading the screen
// beside them. Where the two disagree, the first gets no match and the second
// two different labels. NVDA found the first one (#224).

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const app = read('../site/src/app.js');

const norm = (s) => s.replace(/<br\s*\/?>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

test('the Night Mode button is announced by the words it shows (#224)', () => {
  // Both states: the visible text, then the name set beside it.
  for (const visible of ['Use Night Mode', 'Use Dark Mode']) {
    const name = app.match(new RegExp(`'(${visible}[^']*)'`, 'g'))
      ?.map((s) => s.slice(1, -1)).find((s) => s.length > visible.length);
    assert.ok(name, `no spoken name for "${visible}"`);
    assert.ok(norm(name).startsWith(norm(visible)), `"${name}" does not start with "${visible}"`);
  }
  assert.doesNotMatch(app, /'Switch to (Night|Dark) Mode/, 'the old names are gone');
});
