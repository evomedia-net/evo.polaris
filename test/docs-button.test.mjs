import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE DOCS BUTTON IS A BIG "?" WITH "Docs" UNDER IT (#209).
//
// "the "?" should be bigger and "Docs" below it". It was a bare "?" in body
// text, underlined as a link, with nothing saying where it went. It is now the
// same glyph-over-word shape as the full-screen buttons, in the same --tap box.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = read('../site/index.html');
const css = read('../site/src/style.css');
const rule = (sel) => {
  const i = css.indexOf(`\n${sel} {`);
  assert.ok(i >= 0, `${sel} is gone from style.css`);
  return css.slice(i, css.indexOf('}', i));
};

test('the button shows a "?" with the word "Docs" under it', () => {
  const a = html.slice(html.indexOf('<a id="docsLink"'), html.indexOf('</a>', html.indexOf('<a id="docsLink"')));
  assert.match(a, /<span class="docs-glyph" aria-hidden="true">\?<\/span><span class="docs-word" aria-hidden="true">Docs<\/span>/);
  // Its name says what pressing does, and contains the word on it (WCAG 2.5.3).
  const name = a.match(/aria-label="([^"]+)"/)[1];
  assert.equal(name, 'Read the docs');
  assert.ok(name.toLowerCase().includes('docs'));
});

test('stacked, bigger than body text, not underlined, and still the full touch target', () => {
  assert.match(html, /<a id="docsLink" class="icon-btn docs-btn"/, 'it keeps .icon-btn, which carries the --tap size');
  const btn = rule('.docs-btn');
  assert.match(btn, /flex-direction: column;/);
  assert.match(btn, /text-decoration: none;/);
  const glyph = Number(css.match(/\.docs-glyph \{ font-size: ([\d.]+)rem;/)[1]);
  assert.ok(glyph >= 1.5, `the "?" is ${glyph}rem; it was 1rem`);
});
