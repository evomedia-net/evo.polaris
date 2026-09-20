import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceBasis, altAzToVector, vectorToAltAz, focalLength, projectToScreen,
  buildSkyVectors, starRadius,
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
