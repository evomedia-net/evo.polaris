// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE FOOTER'S LINK IS READABLE, AND RED AT NIGHT (#217).
//
// The "Read the source code on GitHub" link went in unstyled, so it was the
// browser's default #0000ee: 2.09:1 on this page (WCAG 1.4.3 asks 4.5:1) and
// the one blue thing in Night Mode. It takes the footer's own ink, which the
// theme already sets for both modes, and an underline so it reads as a link
// without colour (1.4.1).

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = read('../site/index.html');
const css = read('../site/src/style.css');

test('the footer has a link, and it wears the footer ink, underlined', () => {
  const foot = html.slice(html.indexOf('<footer class="foot">'), html.indexOf('</footer>'));
  assert.match(foot, /<a href="https:\/\/github\.com\/evomedia-net\/evo\.polaris"/);
  const i = css.indexOf('\n.foot a {');
  assert.ok(i >= 0, '.foot a has no rule: it falls back to the browser blue');
  const rule = css.slice(i, css.indexOf('}', i));
  assert.match(rule, /color: inherit;/);
  assert.match(rule, /text-decoration: underline;/);
});
