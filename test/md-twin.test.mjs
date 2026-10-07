// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// A hand-kept plain-text duplicate drifts, and the drift is invisible precisely
// because nobody reads both copies. Generating the twins is only half the fix:
// this makes a forgotten regeneration fail the suite instead of shipping a
// mirror that quietly disagrees with its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sources, stale, render } from '../scripts/md-txt.mjs';

test('every prose .md has a .txt twin in sync', () => {
  const out = stale();
  assert.deepEqual(out, [],
    `out of sync: ${out.join(', ')} — run: npm run docs:twins`);
});

test('there is at least one twinned document', () => {
  assert.ok(sources().length > 0, 'no .md sources discovered');
});

test('rendering strips markup but keeps the words and link targets', () => {
  const txt = render('# Title\n\nSome **bold** and `code` and [a link](https://x.test).\n');
  assert.ok(txt.startsWith('Title\n====='), 'heading should be underlined');
  assert.ok(txt.includes('Some bold and code'), 'markers should be stripped');
  assert.ok(txt.includes('a link (https://x.test)'), 'link target should survive');
  assert.ok(!txt.includes('**') && !txt.includes('`'), 'no markup should remain');
});

test('a picture becomes its alt text, whether written as markdown or as an HTML <img>', () => {
  // README sizes its screenshots with <img width>, which markdown cannot do (#213).
  const txt = render('![A dial](a.png)\n<img src="b.png" width="280" alt="The sky in red">\n');
  assert.ok(txt.includes('A dial'), 'markdown image -> alt text');
  assert.ok(txt.includes('The sky in red'), 'HTML image -> alt text');
  assert.ok(!txt.includes('<img') && !txt.includes('b.png'), 'no tag or path should remain');
});
