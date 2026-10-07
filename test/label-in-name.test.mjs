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

// EVERY BUTTON, NOT JUST THAT ONE (#226). Checking every button in every state
// found six more: "Planets" announced as "Point at the next planet…", "Full
// screen" as "Fill the screen", "Change date" as "Change the date" and so on.

const html = read('../site/index.html');

/** What a sighted person reads on the control: the words, not the glyphs. */
const visibleWords = (inner) => norm(inner.replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ')
  .replace(/[^\p{L}\p{N}' -]/gu, ' '));

test('every button and link in the page is named with the words it shows', () => {
  const re = /<(button|a)\b([^>]*\baria-label="([^"]*)"[^>]*)>([\s\S]*?)<\/\1>/g;
  const bad = [];
  let n = 0;
  for (const m of html.matchAll(re)) {
    const [, , attrs, name, inner] = m;
    const words = visibleWords(inner);
    if (!words) continue;
    n++;
    if (!norm(name).includes(words)) bad.push(`${(attrs.match(/id="([^"]+)"/) || [])[1]}: shows "${words}", named "${name}"`);
  }
  assert.ok(n > 20, `only ${n} named controls found`);
  assert.deepEqual(bad, []);
});

test('the names swapped in at runtime contain the words swapped in beside them', () => {
  // [what the button shows, what it is called], for each state app.js sets.
  const pairs = [
    ['Change<br>date', 'Change date, to see the sky at another time'],
    ['Hide the<br>boxes', 'Hide the boxes for the date'],
    ['Set your<br>location', 'Set your location'],
    ['Hide the<br>boxes', 'Hide the boxes for your position'],
    ['Skip what is down', 'Skip what is down: pass over planets and constellations below the horizon'],
    ['Include what is down', 'Include what is down: stop at planets and constellations below the horizon too'],
    ['Full screen', 'Use full screen'],
    ['Exit', 'Exit full screen'],
    ['Use WCAG Mode', 'Use WCAG Mode, a version of this app that meets WCAG 2.2 level AA.'],
    ['Exit WCAG Mode', 'Exit WCAG Mode. It is on now: a version of this app that meets '],
  ];
  const joined = app.replace(/'\s*\+\s*'/g, '');
  for (const [shows, name] of pairs) {
    assert.ok(joined.includes(`'${shows}`) || html.includes(shows), `app.js no longer shows "${shows}"`);
    assert.ok(joined.includes(name), `app.js no longer names it "${name}"`);
    assert.ok(norm(name).includes(norm(shows)), `"${name}" does not contain "${shows}"`);
  }
});
