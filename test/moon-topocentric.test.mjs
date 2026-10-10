// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { julianDay, lstHours } from '../site/src/astro.js';
import { moonPhase, topocentricMoon } from '../site/src/moon.js';
import { equatorialToVector, vectorToAltAz } from '../site/src/skyview.js';

// THE MOON IS WHERE IT IS FROM HERE (#263).
//
// Kelly asked to "check all targets". Every Track target was run through the
// sky view's own code and compared with JPL Horizons, topocentric and
// airless. The Sun and the planets were within 0.08 degrees and the ISS
// within 0.012. The Moon was 0.24 to 0.83 degrees off: the Earth-centred
// position, drawn as if seen from here, and a six-term series on top.
//
// These are Horizons' own answers -- apparent azimuth and elevation, no
// refraction -- for Boston and Denver at 14 instants, copied from its API on
// 2026-10-10. The app now gets every one within 0.05 degrees (worst seen:
// 0.014), and the Earth-centred position misses at least one by far more.

const BOSTON = { lat: 42.3601, lon: -71.0589 };
const DENVER = { lat: 39.7392, lon: -104.9903 };
const HORIZONS = [
  ['2023-01-01T00:00:00Z', BOSTON, 59.15, 175.48], ['2023-01-01T00:00:00Z', DENVER, 47.08, 120.70],
  ['2026-10-10T22:00:00Z', BOSTON, -2.27, 255.19], ['2026-10-10T22:00:00Z', DENVER, 21.65, 230.75],
  ['2026-10-11T03:00:00Z', BOSTON, -53.31, 314.28], ['2026-10-11T03:00:00Z', DENVER, -31.74, 279.13],
  ['2026-10-11T09:00:00Z', BOSTON, -31.81, 80.88], ['2026-10-11T09:00:00Z', DENVER, -55.84, 50.41],
  ['2026-10-17T04:00:00Z', BOSTON, -23.15, 252.92], ['2026-10-17T04:00:00Z', DENVER, 0.55, 232.03],
  ['2026-10-25T03:00:00Z', BOSTON, 57.02, 166.19], ['2026-10-25T03:00:00Z', DENVER, 42.46, 116.91],
  ['2026-12-26T15:54:00Z', BOSTON, -13.98, 310.02], ['2026-12-26T15:54:00Z', DENVER, 7.27, 286.75],
];

const DEG = Math.PI / 180;
function sep(a, b) {
  const v = (x) => [Math.cos(x.alt * DEG) * Math.cos(x.az * DEG),
    Math.cos(x.alt * DEG) * Math.sin(x.az * DEG), Math.sin(x.alt * DEG)];
  const p = v(a), q = v(b);
  return Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) / DEG;
}

/** Where the sky view puts the Moon: the same calls app.js makes. */
function skyView(when, site, here = true) {
  const lst = lstHours(julianDay(when), site.lon);
  const ph = moonPhase(when);
  const at = here ? topocentricMoon(ph, lst, site.lat) : ph;
  return vectorToAltAz(equatorialToVector(at.ra, at.dec, lst, site.lat, null));
}

test('the Moon is within 0.05 degrees of JPL Horizons, seen from here', () => {
  for (const [t, site, alt, az] of HORIZONS) {
    const off = sep(skyView(new Date(t), site), { alt, az });
    assert.ok(off < 0.05, `${t} at ${site.lat}: ${off.toFixed(3)} degrees from Horizons`);
  }
});

test('the Earth-centred Moon would miss by more than a Moon-width', () => {
  // The reason the correction exists: without it the worst of these is well
  // over half a degree, and the Moon itself is half a degree across.
  const worst = Math.max(...HORIZONS.map(([t, site, alt, az]) =>
    sep(skyView(new Date(t), site, false), { alt, az })));
  assert.ok(worst > 0.5, `worst Earth-centred miss was only ${worst.toFixed(3)} degrees`);
});

test('the shift is downward and largest at the horizon', () => {
  // Parallax always lowers the Moon, by about 0.95 degrees at the horizon
  // and by less the higher it is.
  const when = new Date('2026-10-10T22:00:00Z');
  const site = DENVER;
  const there = skyView(when, site, false), here = skyView(when, site, true);
  assert.ok(here.alt < there.alt, 'seen from the surface the Moon is lower');
  const drop = there.alt - here.alt;
  assert.ok(drop > 0.5 && drop < 1.0, `dropped ${drop.toFixed(3)} degrees`);
});
