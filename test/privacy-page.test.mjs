// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE PRIVACY PAGE SAYS WHAT THE CODE DOES, AND ONLY THAT.
//
// Both app stores require a privacy policy at a public URL, and a policy is a
// claim about the code -- the same kind of claim as a galaxy's position, and
// held the same way: every host the app's own code asks for something must be
// named on the page, so a new request cannot ship with the page left behind.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const page = read('../site/privacy.html');
const html = read('../site/index.html');
const srcDir = fileURLToPath(new URL('../site/src/', import.meta.url));
const code = readdirSync(srcDir).filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(srcDir + f, 'utf8')).join('\n');

test('every outside service the code asks for something is named on the page', () => {
  // fetch(...) to an absolute URL is the only way the app leaves its own origin.
  const hosts = new Set([...code.matchAll(/fetch(?:Fn)?\(\s*'https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]));
  assert.ok(hosts.size >= 2, `found only ${[...hosts].join(', ')}`);
  for (const h of hosts) {
    const name = h.replace(/^api\./, '');
    assert.ok(page.includes(name), `the code asks ${h}, and the privacy page does not say so`);
  }
});

test('it says the position stays on the device, and when it does not', () => {
  assert.match(page, /Your position stays on your device/);
  assert.match(page, /Only when you press the button that looks up your ground elevation/);
  assert.match(code, /api\.open-meteo\.com\/v1\/elevation/, 'the elevation lookup is where the page says');
});

test('the usage-time report is described as the code sends it', () => {
  const dwell = read('../site/src/dwell.js');
  assert.match(dwell, /export const MIN_SECONDS = 10;/);
  assert.match(page, /not at all for visits under ten seconds/);
  assert.match(dwell, /globalPrivacyControl === true/);
  assert.match(page, /Do Not Track or Global Privacy Control/);
  assert.match(dwell, /export const BEACON_PATH = '\/api\/visit';/, 'it goes to the same server, by a relative path');
});

test('the page is linked from the app, and names who to ask', () => {
  assert.match(html, /<a href="privacy\.html">Privacy<\/a>/);
  assert.match(page, /mailto:dev@evomedia\.net/);
  assert.match(page, /Evomedia\.net LLC/);
  assert.match(page, /<title>Privacy — evo\.polaris — evomedia\.net<\/title>/, 'evomedia.net, all lower case');
});
