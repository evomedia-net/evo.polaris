// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE SITE NAME IS evomedia.net, ALL LOWERCASE, AND THAT INCLUDES THE WORDMARK.
//
// The lowercase sweep (#114) changed every place the name was written whole,
// and missed the one place it was not: the strip's wordmark is built as two
// spans, "Evomedia" and ".net", so a search for "Evomedia.net" never found
// it. NVDA found it, reading the link aloud as "Evomedia.net" (#248).

const src = readFileSync(fileURLToPath(new URL('../site/src/evomedia-chrome.js', import.meta.url)), 'utf8');

test('the strip\'s wordmark reads evomedia.net, lowercase', () => {
  const html = src.match(/brand\.innerHTML = `\$\{MARK\}(.*)`;/);
  assert.ok(html, 'the wordmark markup has moved; point this test at it');
  const text = html[1].replace(/<[^>]+>/g, '');
  assert.equal(text, 'evomedia.net');
});
