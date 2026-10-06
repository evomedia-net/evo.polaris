// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A DEPLOY HAS TO REACH A PHONE ON ITS NEXT REFRESH (#188).
//
// "Why did Polaris not update from 40 to 41?" / "I've been refreshing the
// page". v0.0.1.0.41 was live, the worker had updated, and the phone showed
// v0.0.1.0.40 through every refresh. nginx sends no Cache-Control, so the
// browser guesses how long a file is fresh -- about a tenth of its age -- and
// the worker's "network first" fetch was answered from the browser's cache
// without asking the server. Its install copied the same stale files into the
// new cache. These hold the worker to asking the server.

const sw = readFileSync(fileURLToPath(new URL('../site/sw.js', import.meta.url)), 'utf8');

const block = (from, to) => {
  const i = sw.indexOf(from);
  assert.ok(i >= 0, `${from} is gone from sw.js`);
  return sw.slice(i, sw.indexOf(to, i));
};

test('the install fetches every precached file fresh, not from the browser cache', () => {
  const install = block("addEventListener('install'", '\n});');
  assert.match(install, /addAll\(ASSETS\.map\(\(url\) => new Request\(url, \{ cache: 'reload' \}\)\)\)/,
    'a plain addAll(ASSETS) can copy a stale browser-cached file into the new cache');
});

test('the app shell asks the server every time it is online', () => {
  const shell = block('// App shell: prefer the network', '\n});');
  assert.match(shell, /fetch\(request, \{ cache: 'no-cache' \}\)/,
    'a plain fetch(request) is answered from the browser cache while the guess says fresh');
  assert.ok(!/fetch\(request\)\s*\n?\s*\.then/.test(shell), 'the shell must not fetch with the default cache mode');
});
