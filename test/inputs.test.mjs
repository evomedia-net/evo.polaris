// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// EVERY BOX YOU TYPE IN IS A REAL TARGET, IN EVERY CARD.
//
// "It's a little comical. The input for your date in the app that is easy for
// disabled people to use. The input box is absolutely tiny and very hard to
// select and even read."
//
// Measured at 375x812 at the default text size, before this test existed:
//
//                       date and time      the coordinate boxes
//     height            21 px              57.8 px
//     font size         13.3 px            18.7 px
//     min-height        none               var(--tap)
//     ink               black on WHITE     the app's own
//
// Nothing was wrong with the date field. NOTHING WAS SET ON IT. Every input
// rule was written `.manual input`, scoped to the card holding the coordinate
// boxes, so a field one card down got browser defaults -- 21 px against this
// app's own 57.8 px floor, and under the WCAG 2.2 AA minimum of 24 px as well.
//
// So the selector was the bug. A card-scoped rule means the NEXT input is born
// unstyled too, looks fine in review, and is found by somebody trying to use
// it in a dark field. This test is here to refuse the narrow selector.

const root = new URL('../site/', import.meta.url);
const css = readFileSync(fileURLToPath(new URL('src/style.css', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');

/** The body of one CSS rule, by exact selector. */
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.notEqual(i, -1, `the rule "${selector}" is gone`);
  return css.slice(i, css.indexOf('}', i));
}

const FIELDS = "input:not([type='checkbox']):not([type='radio'])";

test('the input rule reaches every card, not one of them', () => {
  // The whole fix in one assertion: the selector must not be scoped to an
  // ancestor, or the next input added elsewhere is unstyled again.
  const body = rule(FIELDS);
  assert.match(body, /min-height: var\(--tap\)/);
  assert.match(body, /font-size: 1\.1rem/);
  // And the card-scoped one must be gone, not merely joined by a broader rule:
  // left in place it would keep working, and the gap it leaves is invisible.
  assert.ok(!/\.manual input \{/.test(css),
    '.manual input must be gone — a card-scoped input rule is the bug');
});

test('every input in the page is one the rule covers', () => {
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(inputs.length >= 4, `only found ${inputs.length} inputs`);
  for (const tag of inputs) {
    const type = (tag.match(/type="([^"]+)"/) || [])[1] || 'text';
    assert.ok(!['checkbox', 'radio'].includes(type),
      `a ${type} is outside the rule and needs its own sizing: ${tag}`);
  }
  // The one this was reported about, still there and still a real field.
  assert.match(html, /<input id="inWhen" type="datetime-local">/);
});

test('the label above a field is a grid in every card, not just the manual one', () => {
  // The date field's own label was display:inline, so its hint and its box
  // ran together on one line while the coordinate labels stacked.
  assert.match(rule('.card label'), /display: grid/);
  assert.ok(!/\.manual label \{/.test(css), 'the card-scoped label rule must be gone too');
});

test('a field is the app\'s own ink, and pure red on black at night', () => {
  const body = rule(FIELDS);
  assert.match(body, /color: var\(--ink\)/);
  assert.match(body, /background: var\(--bg\)/);
  // --bg and --ink are redefined by the night theme, so those two follow it
  // on their own. --line is not, so the border has to be named.
  assert.match(rule(`html[data-night='on'] ${FIELDS}`), /border-color: var\(--ink\)/);
  // The white box this started as must not be reachable from any input rule.
  assert.ok(!/input[^{]*\{[^}]*background:\s*#fff/i.test(css));
});

test('the native picker draws its own chrome dark', () => {
  // The calendar, the spinners and the little arrow are the browser's, and it
  // takes their colours from color-scheme rather than from ours. Left alone it
  // hands a dark-adapted eye a white calendar -- and dark adaptation takes
  // twenty minutes to build and one bright screen to lose.
  assert.match(rule(FIELDS), /color-scheme: dark/);
});

test('the dead night rule is gone', () => {
  // `.manual input { background: transparent; }` sat among the Night Mode
  // rules without being scoped to night, and was overridden by the later
  // .manual input block anyway. It read like a night rule that lost its
  // selector, and it did nothing at all.
  assert.ok(!/background: transparent;\s*\}\s*html\[data-night='on'\] \.figure\.accent/.test(css));
});
