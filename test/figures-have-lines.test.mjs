import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONSTELLATIONS } from '../site/src/data/constellations.js';
import { FIGURES } from '../site/src/data/figures.js';

// EVERY DRAWING HAS ITS LINES AND ITS NAME.
//
// "This artwork doesn't seem to have any corresponding constellations. Is
// that correct?" It was: the drawings were chosen as the zodiac and fourteen
// beginner's figures, the stick figures separately, and six drawings --
// Aries, Cancer, Libra, Capricornus, Aquarius, Pisces -- floated on the sky
// with no lines, no name and no place in the Constellations walk. Nothing
// had ever checked them against their stars either, because there were no
// stars to check against.

const root = new URL('../', import.meta.url);
const stars = JSON.parse(readFileSync(fileURLToPath(new URL('site/src/data/stars.json', root)), 'utf8'));
const byHr = new Map(stars.filter((s) => s.length > 5).map((s) => [s[4], s]));
const hrOf = (name) => stars.find((s) => s.length > 5 && s[5] === name)[4];
const starsOf = (k) => new Set(CONSTELLATIONS[k].lines.flat());
const builder = readFileSync(fileURLToPath(new URL('scripts/build-constellations.py', root)), 'utf8');

test('every drawing has a stick figure and a name', () => {
  for (const f of FIGURES) {
    const c = CONSTELLATIONS[f.a];
    assert.ok(c, `${f.n} is drawn but has no stick figure`);
    assert.ok(c.name && c.lines.length >= 2, `${f.n} has no name or almost no lines`);
  }
});

test('the six that floated are named the way people name them', () => {
  for (const [k, name] of [['Ari', 'Aries'], ['Cnc', 'Cancer'], ['Lib', 'Libra'],
    ['Cap', 'Capricornus'], ['Aqr', 'Aquarius'], ['Psc', 'Pisces']]) {
    assert.equal(CONSTELLATIONS[k]?.name, name);
  }
  // Spot checks of the shapes, by the stars everyone knows them by.
  assert.ok(starsOf('Ari').has(hrOf('13Alp Ari')) && starsOf('Ari').has(hrOf('6Bet Ari')), 'Hamal and Sheratan');
  assert.ok(starsOf('Lib').has(hrOf('9Alp2Lib')) && starsOf('Lib').has(hrOf('27Bet Lib')), 'the two claws');
  assert.ok(starsOf('Cap').has(hrOf('49Del Cap')), 'Deneb Algedi');
  assert.ok(starsOf('Aqr').has(hrOf('34Alp Aqr')) && starsOf('Aqr').has(hrOf('22Bet Aqr')), 'Sadalmelik and Sadalsuud');
  assert.ok(starsOf('Psc').has(hrOf('113Alp Psc')), 'Alrescha, the knot');
  assert.ok(starsOf('Cnc').has(hrOf('47Del Cnc')) && starsOf('Cnc').has(hrOf('43Gam Cnc')), 'the two donkeys');
});

test('Capricornus is matched to the stars its new lines run through', () => {
  // With lines to check against, the sea-goat turned out to sit like the
  // archer's bow did: Deneb Algedi two degrees off the tail, Zeta under the
  // belly, Psi and Omega beside the foreleg.
  const matching = JSON.parse(readFileSync(fileURLToPath(new URL('scripts/figure-matching.json', root)), 'utf8'));
  const stars = matching.Cap.filter((p) => typeof p[2] === 'string').map((p) => p[2]).sort();
  assert.deepEqual(stars, ['Del', 'Ome', 'Psi', 'Zet']);
  assert.ok(matching.Cap.filter((p) => Array.isArray(p[2])).length >= 6, 'the horns, head, back and tail are pinned');
});

test('no line runs to a star the sky view does not draw', () => {
  // The view draws the catalogue to magnitude 5.5. A line ending at a star
  // fainter than that ends at nothing -- Pisces, the faintest of these,
  // reaches 5.24 at Zeta.
  for (const k of Object.keys(CONSTELLATIONS)) {
    for (const hr of starsOf(k)) {
      const s = byHr.get(hr);
      assert.ok(s, `${k}: HR ${hr} is not in the catalogue`);
      assert.ok(s[2] <= 5.5, `${k}: ${s[5]} is magnitude ${s[2]}, fainter than the view draws`);
    }
  }
});

test('the Teapot’s spout ends on Alnasl, the arrow’s point, not on gamma-1', () => {
  // #173. The builder tried component 1 before 2, so the spout ran to gamma-1
  // Sagittarii, a faint variable 0.4 degrees away -- right where the bow fix
  // (#171) puts the arrowhead on Alnasl.
  const alnasl = hrOf('10Gam2Sgr');
  const gamma1 = stars.find((s) => s.length > 5 && /^\s*Gam1Sgr$/.test(s[5] || '') )?.[4];
  assert.ok(starsOf('Sgr').has(alnasl), 'the spout does not reach Alnasl');
  if (gamma1 !== undefined) assert.ok(!starsOf('Sgr').has(gamma1), 'the spout still runs to gamma-1');
  // And the rule, not just the case: a bare letter is the brightest component.
  assert.ok(starsOf('Sco').has(hrOf('Zet2Sco')), 'Scorpius should run through zeta-2, the bright one');
  assert.match(builder, /min\(candidates, key=lambda v: v\[1\]\)\[0\]/);
});
