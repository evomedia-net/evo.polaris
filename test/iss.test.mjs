import test from 'node:test';
import assert from 'node:assert/strict';
import {
  geodeticToEcef, lookAngles, fetchIss, describePass,
} from '../site/src/iss.js';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

test('the ellipsoid matches its own defining numbers', () => {
  // On the equator at zero height the distance from the centre is exactly the
  // equatorial radius; at the pole it is the polar radius. Those two are what
  // WGS-84 is defined by, so they are the right things to check against.
  const eq = geodeticToEcef(0, 0, 0);
  near(Math.hypot(...eq), 6378.137, 1e-6, 'equatorial radius');
  const pole = geodeticToEcef(90, 0, 0);
  near(Math.hypot(...pole), 6356.752, 1e-3, 'polar radius');
  // Longitude 90 puts it on the Y axis, not the X one.
  const y = geodeticToEcef(0, 90, 0);
  near(y[0], 0, 1e-6, 'x');
  near(y[1], 6378.137, 1e-6, 'y');
});

test('height is added along the local vertical, not along the radius', () => {
  const ground = geodeticToEcef(45, 10, 0);
  const up = geodeticToEcef(45, 10, 400);

  // The DISPLACEMENT is exactly the height. This is the real invariant.
  const d = [up[0] - ground[0], up[1] - ground[1], up[2] - ground[2]];
  near(Math.hypot(...d), 400, 1e-9, 'displacement is the height');

  // But the distance from the centre is NOT, and that is the ellipsoid rather
  // than an error: away from the equator and the poles the local vertical does
  // not point at the centre of the Earth, so going 400 km "up" moves you
  // slightly less than 400 km further out. At 45 degrees the gap peaks, and it
  // is about two metres. A sphere would give exactly 400.
  const radial = Math.hypot(...up) - Math.hypot(...ground);
  assert.ok(radial < 400 && radial > 399.99,
    `expected slightly under 400 on an ellipsoid, got ${radial}`);

  // At the equator and the pole the vertical IS radial, so there it is exact.
  for (const lat of [0, 90]) {
    const a = geodeticToEcef(lat, 10, 0), b = geodeticToEcef(lat, 10, 400);
    near(Math.hypot(...b) - Math.hypot(...a), 400, 1e-6, `exact at ${lat}`);
  }
});

test('straight overhead reads as ninety degrees', () => {
  const obs = { lat: 42.5, lon: -71.1, heightKm: 0 };
  const look = lookAngles(obs, { lat: 42.5, lon: -71.1, heightKm: 415 });
  near(look.alt, 90, 1e-6, 'altitude');
  near(look.rangeKm, 415, 1e-3, 'range is just the height');
  assert.equal(look.aboveHorizon, true);
});

test('azimuth points the right way round the compass', () => {
  const obs = { lat: 0, lon: 0, heightKm: 0 };
  const north = lookAngles(obs, { lat: 5, lon: 0, heightKm: 415 });
  const south = lookAngles(obs, { lat: -5, lon: 0, heightKm: 415 });
  const east = lookAngles(obs, { lat: 0, lon: 5, heightKm: 415 });
  const west = lookAngles(obs, { lat: 0, lon: -5, heightKm: 415 });
  near(north.az, 0, 1, 'north');
  near(south.az, 180, 1, 'south');
  near(east.az, 90, 1, 'east');
  near(west.az, 270, 1, 'west');
});

test('the far side of the Earth is reported as below the horizon', () => {
  // The important one. Most of the time the station is not visible, and an app
  // that clamps this to the horizon instead of reporting it is inventing a
  // sighting the user then goes outside to look for.
  const obs = { lat: 42.5, lon: -71.1, heightKm: 0 };
  const look = lookAngles(obs, { lat: -42.5, lon: 108.9, heightKm: 415 });
  assert.equal(look.aboveHorizon, false, 'antipode must be below the horizon');
  assert.ok(look.alt < -50, `altitude should be well negative, got ${look.alt}`);
  assert.match(describePass(look, { sunlit: true }), /below the horizon/);
});

test('the horizon is about 2200 km away at that altitude', () => {
  // Geometry check: from 415 km up the station is on the horizon roughly 22
  // degrees of arc away. Inside that it is up, outside it is not.
  const obs = { lat: 0, lon: 0, heightKm: 0 };
  assert.equal(lookAngles(obs, { lat: 0, lon: 18, heightKm: 415 }).aboveHorizon,
    true, '18 degrees away should still be up');
  assert.equal(lookAngles(obs, { lat: 0, lon: 26, heightKm: 415 }).aboveHorizon,
    false, '26 degrees away should be below');
});

test('an eclipsed pass is called out rather than drawn as a sighting', () => {
  const look = { alt: 60, az: 210, rangeKm: 500, aboveHorizon: true };
  const shadow = describePass(look, { sunlit: false });
  assert.match(shadow, /shadow/);
  assert.match(shadow, /nothing to see/);
  const lit = describePass(look, { sunlit: true });
  assert.match(lit, /up and sunlit/);
  assert.match(lit, /60° up/);
});

test('the fetch parses a real response shape', async () => {
  const body = {
    name: 'iss', id: 25544, latitude: 16.4579, longitude: 83.471,
    altitude: 415.9, velocity: 27597.8, visibility: 'eclipsed',
    timestamp: 1789927335,
  };
  const fake = async () => ({ ok: true, json: async () => body });
  const iss = await fetchIss(fake);
  near(iss.lat, 16.4579, 1e-6, 'latitude');
  near(iss.heightKm, 415.9, 1e-6, 'height');
  assert.equal(iss.sunlit, false, 'eclipsed is not sunlit');
  assert.equal(iss.visibility, 'eclipsed');
  assert.ok(iss.at instanceof Date && !Number.isNaN(+iss.at), 'timestamp parsed');
});

test('a bad response is an error, not a silently wrong position', async () => {
  await assert.rejects(
    () => fetchIss(async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(
    () => fetchIss(async () => ({ ok: true, json: async () => ({}) })),
    /no position/);
});
