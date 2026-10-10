// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { julianDay, lstHours, precessionMatrix } from '../site/src/astro.js';
import { buildSkyVectors, vectorToAltAz } from '../site/src/skyview.js';
import { POLARIS_HR } from '../site/src/chart.js';

// THE RING LABELLED POLARIS IS ON POLARIS (#262).
//
// Kelly: "polaris target a little off on pc/phone". The ring was on the
// celestial pole and labelled with the star's name; the star is about 0.65
// degrees away. Now, in the north, the ring is placed from the same star
// vector the chart draws the dot from.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const app = read('../site/src/app.js');
const stars = JSON.parse(read('../site/src/data/stars.json'));
const DEG = Math.PI / 180;
function sep(a, b) {
  const v = (x) => [Math.cos(x.alt * DEG) * Math.cos(x.az * DEG),
    Math.cos(x.alt * DEG) * Math.sin(x.az * DEG), Math.sin(x.alt * DEG)];
  const p = v(a), q = v(b);
  return Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) / DEG;
}

test('the pole and the star are far enough apart to see', () => {
  // Why the old ring looked off: Boston, a winter evening and a summer
  // morning, and the star is 0.6-0.7 degrees from where the ring was.
  const list = Array.isArray(stars) ? stars : stars.stars;
  for (const t of ['2026-01-15T02:00:00Z', '2026-07-15T08:00:00Z']) {
    const when = new Date(t);
    const jd = julianDay(when);
    const site = { lat: 42.3601, lon: -71.0589 };
    const vectors = buildSkyVectors(list, lstHours(jd, site.lon), site.lat, 5.5, precessionMatrix(jd));
    const star = vectors.find((s) => s.hr === POLARIS_HR);
    assert.ok(star, 'Polaris is in the drawn stars');
    const off = sep(vectorToAltAz(star.v), { alt: site.lat, az: 0 });
    assert.ok(off > 0.55 && off < 0.75, `${t}: ${off.toFixed(3)} degrees from the pole`);
  }
});

test('in the north the ring is placed from the drawn star', () => {
  const fn = app.slice(app.indexOf('function poleTarget()'), app.indexOf('function aimTarget('));
  assert.match(fn, /skyVectors\.find\(\(s\) => s\.hr === POLARIS_HR\)/,
    'the ring must come from the same star vector the dot is drawn from');
  assert.match(fn, /solution\.hemisphere !== 'south'/, 'only in the north');
  assert.match(fn, /name: 'Polaris'/);
});

test('in the south, and before the stars are built, it is the pole', () => {
  const fn = app.slice(app.indexOf('function poleTarget()'), app.indexOf('function aimTarget('));
  assert.match(fn, /alt: Math\.abs\(solution\.latitudeSetting\)/);
  assert.match(fn, /'South pole'/);
});
