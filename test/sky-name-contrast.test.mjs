import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// EVERY NAME ON THE SKY MEETS TEXT CONTRAST, IN BOTH THEMES (#195).
//
// "the star text is way too low contrast". Star and galaxy names were drawn
// in the app's `dim` slate, 3.6:1 against the sky by day and 2.1:1 in Night
// Mode; planet, Sun and Moon names were 3.6:1 at night. WCAG asks 4.5:1 for
// text. These compute the ratio from the colours in skydraw.js, so a name
// colour cannot drift back below it unnoticed.

const src = readFileSync(fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const pair = (name) => {
  const m = src.match(new RegExp(`const ${name} = night \\? '(#[0-9a-f]{6})' : '(#[0-9a-f]{6})';`, 'i'));
  assert.ok(m, `${name} is not a night/day pair in skydraw.js`);
  return { night: m[1], day: m[2] };
};

test('a name on the sky is at least 4.5:1 against it, by day and by night', () => {
  const ink = pair('nameInk');
  const sky = pair('skyBg');
  for (const theme of ['day', 'night']) {
    const ratio = contrast(ink[theme], sky[theme]);
    assert.ok(ratio >= 4.5, `${theme}: ${ink[theme]} on ${sky[theme]} is ${ratio.toFixed(2)}:1`);
  }
});

test('the sky is painted with the same colour the halos are drawn in', () => {
  assert.match(src, /ctx\.fillStyle = skyBg;\s*ctx\.fillRect\(0, 0, w, h\);/);
  const fn = src.slice(src.indexOf('const nameText = '), src.indexOf('};', src.indexOf('const nameText = ')));
  assert.match(fn, /ctx\.strokeStyle = skyBg;/, 'the halo is the sky, so a name reads across the art');
  assert.ok(fn.indexOf('strokeText') < fn.indexOf('fillText'), 'halo first, name on top');
  assert.match(fn, /ctx\.fillStyle = nameInk;/);
});

test('every kind of name goes through it: stars, galaxies, planets, the Sun, the Moon', () => {
  for (const call of ["nameText(NAMED.get(s.hr)", 'nameText(g.name', 'nameText(p.name',
    "nameText('Sun'", "nameText('Moon'"]) {
    assert.ok(src.includes(call), `${call} is missing`);
  }
  for (const bare of ["ctx.fillText(NAMED.get(s.hr)", 'ctx.fillText(g.name', 'ctx.fillText(p.name',
    "ctx.fillText('Sun'", "ctx.fillText('Moon'"]) {
    assert.ok(!src.includes(bare), `${bare} draws a name without the readable ink`);
  }
});
