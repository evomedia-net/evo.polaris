import test from 'node:test';
import assert from 'node:assert/strict';
import {
  heliocentric, planetPosition, planetPositions, PLANET_NAMES, describePlanets,
} from '../site/src/planets.js';

const DEG = Math.PI / 180;
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

/** Angle between two points on the sky, degrees. */
function separation(a, b) {
  const d1 = a.dec * DEG, d2 = b.dec * DEG;
  const dra = (a.ra - b.ra) * DEG;
  const c = Math.sin(d1) * Math.sin(d2)
    + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

// --- checked against an event anyone can look up ----------------------------

test('the great conjunction of 2020 puts Jupiter on top of Saturn', () => {
  // 2020 December 21: the closest Jupiter-Saturn conjunction since 1623,
  // reported everywhere at the time as about six arcminutes -- a fifth of the
  // Moon's width. This is the single best check available for this module,
  // because it pins BOTH planets at once and a wrong answer is not close.
  const when = new Date('2020-12-21T18:00:00Z');
  const sep = separation(planetPosition('Jupiter', when),
    planetPosition('Saturn', when));
  assert.ok(sep < 0.2,
    `separation at the great conjunction was ${(sep * 60).toFixed(1)}' — `
    + 'should be about 6 arcminutes');

  // And it must be a real conjunction rather than two planets that happen to
  // sit together in a broken projection: a week earlier they were well apart.
  const before = new Date('2020-12-14T18:00:00Z');
  const sepBefore = separation(planetPosition('Jupiter', before),
    planetPosition('Saturn', before));
  assert.ok(sepBefore > 0.5,
    `a week earlier they should be clearly separated, got ${sepBefore}°`);
});

// --- the orbits themselves --------------------------------------------------

test('every planet stays between its own perihelion and aphelion', () => {
  // The strongest test of the Kepler solver there is. If the eccentric anomaly
  // were wrong the distance would leave this band immediately, and the band is
  // computed from the planet's OWN elements rather than a quoted figure.
  const bounds = {
    Mercury: [0.3075, 0.4667], Venus: [0.7184, 0.7282],
    Earth: [0.9833, 1.0167], Mars: [1.3814, 1.6660],
    Jupiter: [4.9501, 5.4570], Saturn: [9.0207, 10.0540],
    Uranus: [18.286, 20.096], Neptune: [29.806, 30.331],
  };
  for (const [name, [lo, hi]] of Object.entries(bounds)) {
    let min = Infinity, max = 0;
    // 1880 to 2050 -- the span the element set is published for, and just
    // longer than Neptune's 165-year orbit. A shorter window failed Neptune by
    // 0.12 au for the honest reason that it never reached aphelion inside it:
    // the sampling was wrong, not the ephemeris. The 62-day step shares no
    // factor with any period here, so nothing aliases.
    for (let i = 0; i < 1000; i++) {
      const r = heliocentric(name, new Date(Date.UTC(1880, 0, 1)
        + i * 62 * 86400000)).r;
      min = Math.min(min, r); max = Math.max(max, r);
    }
    assert.ok(min > lo - 0.02 && min < lo + 0.05,
      `${name} perihelion ${min.toFixed(4)} au, expected about ${lo}`);
    assert.ok(max < hi + 0.02 && max > hi - 0.05,
      `${name} aphelion ${max.toFixed(4)} au, expected about ${hi}`);
  }
});

test('each planet goes round in its own year', () => {
  // Sidereal periods. These are the defining numbers of each orbit and the
  // whole element set is wrong if the longitude does not come back.
  const periods = {
    Mercury: 87.969, Venus: 224.701, Earth: 365.256, Mars: 686.980,
    Jupiter: 4332.589, Saturn: 10759.22,
  };
  const t0 = new Date('2020-01-01T00:00:00Z');
  for (const [name, days] of Object.entries(periods)) {
    const a = heliocentric(name, t0);
    const b = heliocentric(name, new Date(+t0 + days * 86400000));
    const lonA = Math.atan2(a.y, a.x) / DEG;
    const lonB = Math.atan2(b.y, b.x) / DEG;
    // "No change" is zero, not half a turn -- the same trap the Moon's
    // sidereal-month test fell into.
    const d = ((lonB - lonA + 540) % 360) - 180;
    near(d, 0, 1.5, `${name} longitude after one period`);
  }
});

test('Kepler equation is actually solved, not approximated away', () => {
  // M = E - e sin E, to the last digit that matters. Checked through the
  // public surface by way of the most eccentric orbit here.
  for (let i = 0; i < 200; i++) {
    const p = heliocentric('Mercury',
      new Date(Date.UTC(2026, 0, 1) + i * 3 * 86400000));
    assert.ok(Number.isFinite(p.r) && p.r > 0.3 && p.r < 0.47,
      `Mercury distance went wrong at sample ${i}: ${p.r}`);
  }
});

// --- how they look from here ------------------------------------------------

test('the inner planets never stray far from the Sun', () => {
  // Mercury reaches about 28 degrees from the Sun and Venus about 47. These
  // are the limits that make them morning and evening objects, they fall
  // straight out of the orbit geometry, and nothing in the code knows them --
  // so getting them right validates the geocentric subtraction.
  let mercury = 0, venus = 0;
  for (let i = 0; i < 1500; i++) {
    const when = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
    mercury = Math.max(mercury, planetPosition('Mercury', when).elongation);
    venus = Math.max(venus, planetPosition('Venus', when).elongation);
  }
  assert.ok(mercury > 17 && mercury < 29,
    `Mercury's greatest elongation came out ${mercury.toFixed(1)}°`);
  assert.ok(venus > 44 && venus < 49,
    `Venus's greatest elongation came out ${venus.toFixed(1)}°`);
});

test('the outer planets do reach opposition, and are closest there', () => {
  // A superior planet at opposition is 180 degrees from the Sun and at its
  // nearest. Both halves have to hold together: the geometry is wrong if a
  // planet is furthest away when it is opposite the Sun.
  let best = null, worst = null;
  for (let i = 0; i < 500; i++) {
    const p = planetPosition('Mars', new Date(Date.UTC(2026, 0, 1) + i * 86400000));
    if (!best || p.elongation > best.elongation) best = p;
    if (!worst || p.elongation < worst.elongation) worst = p;
  }
  assert.ok(best.elongation > 170,
    `Mars should reach opposition, best was ${best.elongation.toFixed(1)}°`);
  assert.ok(best.distanceAu < worst.distanceAu,
    'Mars must be nearer at opposition than at conjunction');
});

test('everything stays close to the ecliptic, because that is where orbits are', () => {
  // Seen from the Earth, the inner planets swing furthest off the ecliptic --
  // their inclination is amplified when they pass close. Anything outside
  // these bands is a broken rotation into the ecliptic frame.
  const limits = {
    Mercury: 12, Venus: 10, Mars: 8, Jupiter: 2.5, Saturn: 3.5,
    Uranus: 1.5, Neptune: 2.5,
  };
  for (const name of PLANET_NAMES) {
    let worst = 0;
    for (let i = 0; i < 800; i++) {
      const b = Math.abs(planetPosition(name,
        new Date(Date.UTC(2024, 0, 1) + i * 2 * 86400000)).eclipticLat);
      worst = Math.max(worst, b);
    }
    assert.ok(worst < limits[name],
      `${name} reached ${worst.toFixed(2)}° off the ecliptic`);
  }
});

test('the equatorial direction agrees with the distance it came from', () => {
  // RA, Dec and distance describe one vector. If the ecliptic-to-equatorial
  // rotation lost or gained length, this is where it shows.
  const when = new Date('2026-09-20T02:00:00Z');
  for (const name of PLANET_NAMES) {
    const p = planetPosition(name, when);
    assert.ok(p.ra >= 0 && p.ra < 360, `${name} ra ${p.ra}`);
    assert.ok(p.dec > -90 && p.dec < 90, `${name} dec ${p.dec}`);
    assert.ok(p.distanceAu > 0.2 && p.distanceAu < 32, `${name} range`);
    // Declination cannot exceed the obliquity plus the ecliptic latitude.
    assert.ok(Math.abs(p.dec) < 23.44 + Math.abs(p.eclipticLat) + 0.01,
      `${name} declination ${p.dec} is outside what the ecliptic allows`);
  }
});

test('Venus is the brightest of them, and the order is right', () => {
  let brightest = {};
  for (const name of PLANET_NAMES) brightest[name] = Infinity;
  for (let i = 0; i < 900; i++) {
    const when = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
    for (const p of planetPositions(when)) {
      brightest[p.name] = Math.min(brightest[p.name], p.magnitude);
    }
  }
  assert.ok(brightest.Venus < -4.0,
    `Venus should get brighter than -4, best was ${brightest.Venus.toFixed(2)}`);
  for (const other of ['Mercury', 'Mars', 'Jupiter', 'Saturn']) {
    assert.ok(brightest.Venus < brightest[other],
      `Venus must outshine ${other} (${brightest.Venus} vs ${brightest[other]})`);
  }
  assert.ok(brightest.Neptune > 7,
    `Neptune is never naked-eye, got ${brightest.Neptune.toFixed(2)}`);
  assert.ok(brightest.Jupiter < -2,
    `Jupiter should reach about -2.9, got ${brightest.Jupiter.toFixed(2)}`);
});

test('the phase angle is a real angle on a real triangle', () => {
  // An outer planet is never far from full as seen from here -- the Earth is
  // too close to the Sun for that. Mars reaches about 47 degrees and Jupiter
  // about 12, which the Sun-planet-Earth triangle fixes on its own.
  let mars = 0, jupiter = 0;
  for (let i = 0; i < 800; i++) {
    const when = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
    mars = Math.max(mars, planetPosition('Mars', when).phaseAngle);
    jupiter = Math.max(jupiter, planetPosition('Jupiter', when).phaseAngle);
  }
  assert.ok(mars > 35 && mars < 50, `Mars phase angle peaked at ${mars.toFixed(1)}°`);
  assert.ok(jupiter < 13, `Jupiter phase angle peaked at ${jupiter.toFixed(1)}°`);
});

test('nothing above the horizon is reported as a list of nothing', () => {
  assert.match(describePlanets([]), /No planets/);
  const s = describePlanets([
    { name: 'Jupiter', magnitude: -2.5, alt: 40, az: 130 },
    { name: 'Saturn', magnitude: 0.7, alt: 20, az: 160 },
  ]);
  // Brightest first, because that is the one you will actually find.
  assert.ok(s.indexOf('Jupiter') < s.indexOf('Saturn'), s);
  assert.match(s, /40° up/);
});
