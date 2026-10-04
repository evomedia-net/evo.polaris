import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BELOW_HORIZON_ALPHA } from '../site/src/skydraw.js';

// A PATH BELOW THE HORIZON IS FAINTER, NOT GONE (#202).
//
// "ISS dash line is not the bright blue the top legend shows and is almost
// invisible". Below the horizon a path was drawn at 30%: the ISS's #7fd4ff
// came out about 2:1 against the sky. WCAG 1.4.11 asks 3:1 of lines and
// shapes. This blends each path's own colour over the sky at the alpha the
// drawing uses and holds every one to that.

const app = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const draw = readFileSync(fileURLToPath(new URL('../site/src/skydraw.js', import.meta.url)), 'utf8');

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const over = (fg, bg, a) => fg.map((v, i) => a * v + (1 - a) * bg[i]);
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const sky = rgb(draw.match(/const skyBg = night \? '#000000' : '(#[0-9a-f]{6})';/i)[1]);
const styles = [...app.matchAll(/(\w+):\s*\{ colour: '(#[0-9a-f]{6})', nightColour/gi)].map((m) => [m[1], m[2]]);

test('every path keeps 3:1 against the sky where it runs below the horizon', () => {
  assert.ok(styles.length >= 3, 'TRACK_STYLE has the ISS, the planets and the Moon');
  for (const [name, colour] of styles) {
    const ratio = contrast(over(rgb(colour), sky, BELOW_HORIZON_ALPHA), sky);
    assert.ok(ratio >= 3, `${name} (${colour}) below the horizon is ${ratio.toFixed(2)}:1`);
  }
});

test('and is still plainly fainter there than above it', () => {
  assert.match(draw, /ctx\.globalAlpha = runUp \? 0\.85 : BELOW_HORIZON_ALPHA;/);
  assert.ok(BELOW_HORIZON_ALPHA < 0.85 - 0.2, 'below must still read as the fainter half');
});
