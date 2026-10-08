// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE DATE BOX OPENS AT NOW, AND SAYS SO (#229).
//
// It offered tonight at nine, silently: at 3:27 PM the box read 9:00 PM under
// "as the clock will read where you are standing" -- "it's only 3:27pm here" --
// and one press of Use this date and time drew the sky five and a half hours
// from where it is: "5.5hrs means many items in the sky are out of their
// location".

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const app = read('../site/src/app.js');
const html = read('../site/index.html');
const opener = app.slice(app.indexOf("$('whenChange').onclick"), app.indexOf("$('whenApply').onclick"));

test('the box opens at the real time, or at the time already set', () => {
  assert.match(opener, /\$\('inWhen'\)\.value = localInputValue\(plannedFor \? appTime\(\) : now\);/);
  assert.doesNotMatch(app, /eveningToday|setHours\(21/, 'no silent nine o\'clock any more');
});

test('the line under the box says what the time is now', () => {
  assert.match(html, /<input id="inWhen" type="datetime-local" aria-describedby="whenNowNote whenTzNote">/);
  assert.match(html, /<p class="hint" id="whenNowNote"><\/p>/);
  assert.match(opener, /`It is \$\{clock\} now\. Change this to the date and time you will be out, `/);
  assert.match(opener, /`It is \$\{clock\} now\. The box shows the time you set\.`/);
});

test('opening the panel never moves the sky; only the button does', () => {
  // plannedFor is what every drawing reads; the panel only fills the box.
  assert.doesNotMatch(opener, /plannedFor =/);
  assert.match(app, /\$\('whenApply'\)\.onclick = \(\) => \{[\s\S]*?plannedFor = d\.toISOString\(\);/);
});
