// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A FLEX CONTAINER EATS THE SPACES BETWEEN ITS WORDS.
//
// Reported from the app: "Which way istrue north?" and "FindPolarisin the sky".
// The spaces were in the markup the whole time. `.card h2` was display:flex,
// and a flex container makes an anonymous flex item of every RUN of text while
// discarding the whitespace-only runs between them -- so the spaces around the
// inline spans the app rewrites by hemisphere never rendered.
//
// WHY THIS NEEDS A TEST AND NOT JUST A FIX. It has now been met from both
// sides. A `gap` on the same rule once put air around the punctuation ("Which
// way is | true north | ?"), and removing the gap traded too much spacing for
// none at all. Both are the same cause, and the next person reaching for
// display:flex on a heading to line the step circle up will reintroduce it.
//
// It also defeats the obvious check: textContent still reports the whitespace
// text nodes ("1 Which way is true north?") even though nothing renders them.
// Only innerText shows the truth. A source-reading test does not have that
// blind spot.

const root = new URL('../site/', import.meta.url);
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');

/**
 * The body of one CSS rule, by selector.
 *
 * Anchored to the start of a line on purpose: a bare indexOf for ".step {"
 * also matches inside "html[data-night='on'] .step {", and the night-mode
 * override is not the rule any of this is about. (Found by this test failing
 * against a correct fix, which is the good direction for a test to be wrong
 * in.)
 */
function rule(selector) {
  const i = css.indexOf(`\n${selector} {`);
  assert.notEqual(i, -1, `the rule "${selector}" is gone`);
  return css.slice(i, css.indexOf('}', i));
}

test('the step headings are not flex containers', () => {
  const h2 = rule('.card h2');
  assert.ok(!/display:\s*flex/.test(h2),
    '.card h2 must not be a flex container — it drops the spaces between the '
    + 'words, which is what rendered "Which way istrue north?"');
});

test('the step circle sits inline instead', () => {
  // The reason .card h2 was flex was to centre the numbered circle against the
  // text. inline-grid does that without turning the heading into a flex row.
  assert.match(rule('.step'), /display:\s*inline-grid/,
    '.step must be inline-grid so the heading can stay normal inline flow');
});

test('the headings that exposed this still have their inline spans', () => {
  // If these ever become plain text the test above stops protecting anything,
  // because a single run of text has no whitespace-only runs to lose. The
  // spans exist because the app rewrites them by hemisphere.
  for (const [id, span] of [['h-north', 'poleWord2'], ['h-find', 'poleWord4']]) {
    const h = html.slice(html.indexOf(`id="${id}"`));
    const tag = h.slice(0, h.indexOf('</h2>'));
    assert.ok(tag.includes(`id="${span}"`),
      `#${id} must still contain the #${span} span this test is guarding`);
    // And the spaces themselves must survive in the source.
    assert.match(tag, /<\/span>\s/,
      `#${id} must keep a space after the rewritten span`);
  }
});
