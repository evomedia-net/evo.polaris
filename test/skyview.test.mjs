import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceBasis, altAzToVector, vectorToAltAz, focalLength, projectToScreen,
  buildSkyVectors, starRadius, applyScreenAngle, smoothAngle, altitudeFromTilt,
  galacticToEquatorial, milkyWayBrightness, buildMilkyWay,
} from '../site/src/skyview.js';
import { equatorialToHorizontal } from '../site/src/astro.js';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

// --- the device basis -------------------------------------------------------
// These are the anchors. A sky view that is rotated, mirrored or gimballed
// still looks exactly like a sky view, so the basis is pinned by hand-checked
// cases rather than by looking at the picture.

test('upright and facing north aims the back of the phone at the horizon', () => {
  const b = deviceBasis(0, 90, 0);
  const f = vectorToAltAz(b.forward);
  near(f.alt, 0, 1e-9, 'altitude');
  near(f.az, 0, 1e-9, 'azimuth');
  // screen up is world up; screen right is east
  near(b.up[2], 1, 1e-9, 'screen up points at the zenith');
  near(b.right[0], 1, 1e-9, 'screen right points east');
});

test('tilting back raises where the phone is aimed', () => {
  // beta 136 is the case the arrows use: 46 degrees above the horizon.
  near(vectorToAltAz(deviceBasis(0, 136, 0).forward).alt, 46, 1e-6, 'alt at beta 136');
  near(vectorToAltAz(deviceBasis(0, 180, 0).forward).alt, 90, 1e-6, 'flat, face down');
  near(vectorToAltAz(deviceBasis(0, 0, 0).forward).alt, -90, 1e-6, 'flat, face up');
});

test('alpha turns the view, and it agrees with the compass convention', () => {
  // The app reads heading as (360 - alpha), so alpha 90 faces 270 -- west.
  near(vectorToAltAz(deviceBasis(90, 90, 0).forward).az, 270, 1e-6, 'alpha 90');
  near(vectorToAltAz(deviceBasis(270, 90, 0).forward).az, 90, 1e-6, 'alpha 270');
});

test('gamma is not a roll about the view axis, and at beta 90 it is a yaw', () => {
  // Worth pinning, because "gamma is roll" is the natural assumption and it is
  // wrong in a way that only shows up as the view drifting sideways.
  //
  // gamma rotates about the device's own Y axis -- the top-to-bottom axis of
  // the phone -- so it always moves where the BACK points, because the back is
  // -Z and rotating about Y moves Z. A roll that leaves the aim fixed would be
  // rotation about Z, which DeviceOrientation does not give you directly.
  //
  // Held upright at beta 90 the phone's Y axis points at the zenith, so that
  // rotation becomes a pure change of azimuth. That is the ZXY convention's
  // gimbal degeneracy, not a defect here, and the basis stays orthonormal
  // through it (see the test below).
  const flat = deviceBasis(0, 90, 0);
  const rolled = deviceBasis(0, 90, 30);
  const a = vectorToAltAz(flat.forward), b = vectorToAltAz(rolled.forward);
  near(a.alt, b.alt, 1e-6, 'upright, gamma leaves the altitude alone');
  near(((a.az - b.az) + 360) % 360, 30, 1e-6, 'upright, gamma turns the view');

  // Tilted up it moves both, which is the general case.
  const tipped = vectorToAltAz(deviceBasis(0, 136, 40).forward);
  const plain = vectorToAltAz(deviceBasis(0, 136, 0).forward);
  assert.ok(Math.abs(tipped.alt - plain.alt) > 1, 'tilted, gamma moves altitude too');
});

test('the three axes stay a right-handed orthonormal set', () => {
  for (const [a, b, g] of [[0, 90, 0], [37, 120, -25], [200, 60, 80], [0, 0, 0]]) {
    const { right, up, forward } = deviceBasis(a, b, g);
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const len = (p) => Math.sqrt(dot(p, p));
    for (const [n, v] of [['right', right], ['up', up], ['forward', forward]]) {
      near(len(v), 1, 1e-9, `${n} is a unit vector at ${a}/${b}/${g}`);
    }
    near(dot(right, up), 0, 1e-9, 'right . up');
    near(dot(right, forward), 0, 1e-9, 'right . forward');
    near(dot(up, forward), 0, 1e-9, 'up . forward');
  }
});

test('declination rotates the whole basis, not just the heading', () => {
  // 10 degrees east declination: what the device calls north is 10 east of it.
  const plain = vectorToAltAz(deviceBasis(0, 90, 0, 0).forward);
  const corrected = vectorToAltAz(deviceBasis(0, 90, 0, 10).forward);
  near(((corrected.az - plain.az) + 360) % 360, 10, 1e-6, 'azimuth shift');
  // and the correction must not tip the view up or down
  near(corrected.alt, plain.alt, 1e-9, 'altitude untouched by declination');
});

// --- the projection ---------------------------------------------------------

test('what you are aimed at lands in the centre of the screen', () => {
  const basis = deviceBasis(0, 136, 0);
  const p = projectToScreen(basis.forward, basis, focalLength(400, 60));
  near(p.x, 0, 1e-9, 'x');
  near(p.y, 0, 1e-9, 'y');
});

test('anything behind the phone is dropped, not mirrored in front', () => {
  // Without this test the sky behind you is projected through the origin and
  // drawn upside down and back to front -- and it still looks like a sky.
  const basis = deviceBasis(0, 90, 0);                 // aimed north
  const behind = altAzToVector(0, 180);                // due south
  assert.equal(projectToScreen(behind, basis, focalLength(400, 60)), null);
  // exactly 90 degrees off is also behind the image plane
  assert.equal(projectToScreen(altAzToVector(0, 90), basis, focalLength(400, 60)), null);
});

test('a star at the edge of the field lands at the edge of the screen', () => {
  const width = 400, fov = 60;
  const focal = focalLength(width, fov);
  const basis = deviceBasis(0, 90, 0);                 // aimed north, horizon
  const edge = altAzToVector(0, fov / 2);              // half a field to the east
  const p = projectToScreen(edge, basis, focal);
  near(p.x, width / 2, 1e-6, 'right edge');
  near(p.y, 0, 1e-6, 'still level');
});

test('east is on the right and up is up, which a mirrored view would fail', () => {
  const basis = deviceBasis(0, 90, 0);                 // aimed north
  const focal = focalLength(400, 90);
  assert.ok(projectToScreen(altAzToVector(0, 20), basis, focal).x > 0, 'east -> right');
  assert.ok(projectToScreen(altAzToVector(0, 340), basis, focal).x < 0, 'west -> left');
  assert.ok(projectToScreen(altAzToVector(20, 0), basis, focal).y < 0, 'higher -> up');
  assert.ok(projectToScreen(altAzToVector(-20, 0), basis, focal).y > 0, 'lower -> down');
});

test('a narrower field magnifies', () => {
  const basis = deviceBasis(0, 90, 0);
  const star = altAzToVector(0, 10);
  const wide = projectToScreen(star, basis, focalLength(400, 90)).x;
  const tight = projectToScreen(star, basis, focalLength(400, 30)).x;
  assert.ok(tight > wide * 2, `30 deg field should magnify: ${tight} vs ${wide}`);
});

// --- the star vectors -------------------------------------------------------

test('sky vectors agree with the tested alt/az conversion', () => {
  const stars = [[37.95, 89.26, 2.02, 0.6, 424], [0, 0, 9, 0, 1]];
  const lst = 7.3, lat = 42.5;
  const out = buildSkyVectors(stars, lst, lat, 5.5);
  assert.equal(out.length, 1, 'the magnitude 9 star is below the limit');
  const got = vectorToAltAz(out[0].v);
  const want = equatorialToHorizontal(37.95, 89.26, lst, lat);
  near(got.alt, want.alt, 1e-9, 'altitude');
  near(got.az, want.az, 1e-9, 'azimuth');
});

test('Polaris sits at the latitude, due north, from the sky vectors', () => {
  const out = buildSkyVectors([[37.95, 89.26, 2.02, 0.6, 424]], 12, 46, 5.5);
  const { alt, az } = vectorToAltAz(out[0].v);
  near(alt, 46, 1.0, 'Polaris altitude is the latitude, within its own radius');
  assert.ok(az < 2 || az > 358, `Polaris should be due north, got ${az}`);
});

test('brighter stars draw bigger, and nothing vanishes', () => {
  assert.ok(starRadius(-1.4) > starRadius(2) , 'Sirius beats Polaris');
  assert.ok(starRadius(2) > starRadius(5.4), 'Polaris beats a faint one');
  assert.ok(starRadius(5.5) >= 0.6, 'the faintest still has a size');
});

// --- what real phones need --------------------------------------------------

test('the screen angle rotates the picture, not the aim', () => {
  const b = deviceBasis(0, 90, 0);
  const land = applyScreenAngle(b, 90);
  // Aimed at the same patch of sky...
  const a1 = vectorToAltAz(b.forward), a2 = vectorToAltAz(land.forward);
  near(a1.alt, a2.alt, 1e-9, 'altitude unchanged');
  near(a1.az, a2.az, 1e-9, 'azimuth unchanged');
  // ...but the screen's own axes have turned a quarter turn.
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  near(dot(b.right, land.right), 0, 1e-9, 'right has rotated 90 degrees');
  near(Math.abs(dot(b.up, land.right)), 1, 1e-9, 'screen right is the old up');
  // and it stays orthonormal
  near(Math.hypot(...land.right), 1, 1e-9, 'right still a unit vector');
  near(dot(land.right, land.up), 0, 1e-9, 'right still perpendicular to up');
});

test('a zero screen angle is left completely alone', () => {
  const b = deviceBasis(37, 120, -25);
  assert.deepEqual(applyScreenAngle(b, 0), b);
});

test('smoothing crosses north without swinging the long way round', () => {
  // The seam. Averaged naively, 359 and 1 give 180 -- the sky would jump to
  // the opposite horizon every time the heading passed north.
  // Halfway between 359 and 1 IS 0, which is the whole point -- the naive
  // average would be 180, the opposite horizon.
  const out = smoothAngle(359, 1, 0.5);
  const offZero = Math.abs(((out + 180) % 360) - 180);
  assert.ok(offZero < 0.5, `smoothed to ${out}, expected ~0/360 not ~180`);
});

test('smoothing converges and the first reading is taken as-is', () => {
  assert.equal(smoothAngle(null, 42), 42, 'nothing to smooth from');
  let v = 0;
  for (let i = 0; i < 60; i++) v = smoothAngle(v, 90, 0.25);
  near(v, 90, 0.5, 'converges on the target');
  // and it genuinely damps: one step must not arrive
  near(smoothAngle(0, 90, 0.25), 90 * 0.25, 8, 'one step is partial');
});

test('tilt maps a raise-only range onto the sky, not onto the ground', () => {
  // The pointing convention (beta - 90) spends flat-to-vertical getting from
  // the ground to the horizon. Someone who cannot sweep the phone needs that
  // same movement to cover horizon-to-zenith instead.
  assert.equal(altitudeFromTilt(0), 0, 'flat looks at the horizon');
  assert.equal(altitudeFromTilt(45), 45);
  assert.equal(altitudeFromTilt(90), 89, 'vertical looks (almost) straight up');
  // Tipping past vertical, or the other way, must not send the view under the
  // ground -- there is nothing to see there and it reads as a fault.
  assert.equal(altitudeFromTilt(120), 89);
  assert.equal(altitudeFromTilt(-30), 30, 'sign of the tilt does not matter');
  assert.equal(altitudeFromTilt(null), null);
});

// --- the Milky Way ----------------------------------------------------------

test('galactic coordinates land on their known equatorial positions', () => {
  // The two anchors the frame is built from, checked as output rather than
  // assumed: getting this wrong draws the band across the wrong sky.
  const centre = galacticToEquatorial(0, 0);
  near(centre.ra, 266.405, 0.05, 'galactic centre RA (Sgr A*)');
  near(centre.dec, -28.936, 0.05, 'galactic centre Dec');

  const pole = galacticToEquatorial(0, 90);
  near(pole.ra, 192.859, 0.05, 'galactic north pole RA');
  near(pole.dec, 27.128, 0.05, 'galactic north pole Dec');

  // The anticentre sits in Auriga/Taurus, opposite the centre.
  const anti = galacticToEquatorial(180, 0);
  near(anti.ra, 86.4, 0.5, 'anticentre RA');
  near(anti.dec, 28.9, 0.5, 'anticentre Dec');
});

test('known stars land at their published galactic latitudes', () => {
  // Stronger than "is it roughly on the plane": each of these has a catalogued
  // galactic latitude, so the frame can be checked against real numbers. A
  // rotation that is slightly off shows up here and nowhere else.
  const offPlane = (raDeg, decDeg) => {
    let best = 90;
    for (let l = 0; l < 360; l += 0.25) {
      const p = galacticToEquatorial(l, 0);
      const d = Math.acos(Math.max(-1, Math.min(1,
        Math.sin(p.dec * Math.PI / 180) * Math.sin(decDeg * Math.PI / 180)
        + Math.cos(p.dec * Math.PI / 180) * Math.cos(decDeg * Math.PI / 180)
          * Math.cos((p.ra - raDeg) * Math.PI / 180)))) * 180 / Math.PI;
      if (d < best) best = d;
    }
    return best;
  };
  // [name, RA, Dec, published |galactic latitude|]
  const cases = [
    ['Deneb', 310.358, 45.280, 2.0],
    ['Sadr', 305.557, 40.257, 2.2],
    ['Gamma Sgr', 271.452, -30.424, 4.7],
    ['Epsilon Sgr', 276.043, -34.385, 10.2],
    ['Polaris', 37.95, 89.26, 26.5],
  ];
  for (const [name, ra, dec, want] of cases) {
    near(offPlane(ra, dec), want, 0.6, `${name} galactic latitude`);
  }
});

test('the band is brightest toward the centre and fades off the plane', () => {
  assert.ok(milkyWayBrightness(0, 0) > milkyWayBrightness(180, 0),
    'Sagittarius should outshine the anticentre');
  assert.ok(milkyWayBrightness(0, 0) > milkyWayBrightness(0, 15),
    'brightest on the plane itself');
  assert.ok(milkyWayBrightness(0, 40) < 0.05, 'gone well off the plane');
  for (const [l, b] of [[0, 0], [90, 5], [270, -10], [180, 0]]) {
    const v = milkyWayBrightness(l, b);
    assert.ok(v >= 0 && v <= 1, `brightness out of range at ${l}/${b}: ${v}`);
  }
});

test('the band is built as patches with usable brightness', () => {
  const band = buildMilkyWay(7.3, 42.5);
  assert.ok(band.length > 200, `expected a band, got ${band.length} patches`);
  assert.ok(band.every((p) => p.a >= 0.06 && p.a <= 1), 'brightness in range');
  assert.ok(band.every((p) => Math.abs(Math.hypot(...p.v) - 1) < 1e-9),
    'every patch is a unit direction');
});
