// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// EVERY HTML COMMENT ENDS WHERE IT WAS MEANT TO.
//
// A note in index.html quoted Kelly's "[<--] and [-->]" for the arrow
// buttons, and the "-->" in it closed the comment early: the rest of the
// note was drawn down the left of the full-screen sky as text, and it pushed
// the Up arrow out of the pad. Nothing failed, because nothing was looking.
// A comment that ends early leaves one more "-->" than "<!--", so count them.

const html = readFileSync(fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');

test('index.html opens and closes the same number of comments', () => {
  const opens = (html.match(/<!--/g) || []).length;
  const closes = (html.match(/-->/g) || []).length;
  assert.equal(closes, opens, 'a "-->" inside a comment ends it early and spills the rest onto the page');
});

test('and no comment contains the start of another', () => {
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    assert.ok(!m[1].includes('<!--'), `a comment opens inside another: ${m[1].slice(0, 60)}`);
  }
});
