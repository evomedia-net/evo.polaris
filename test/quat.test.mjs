import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY, mul, normalize, conjugate, fromAxisAngle, rotate,
  basisOf, fromBasis, fromAim, altitudeOf, upright, aimLevel, slerp, clampAltitude,
} from '../site/src/quat.js';
import {
  basisFromAim, altAzToVector, vectorToAltAz, screenToVector, focalLength,
} from '../site/src/skyview.js';

// THE ROTATION MATHS, CHECKED AGAINST THE ANGLES IT REPLACES.
//
// The tests that matter most are the ones AT the places the old angle
// pipeline broke: the limit a drag could not reach, the nadir where it gave
// up, and the off-centre drag that walked sideways. Everywhere else it has
// to agree exactly with basisFromAim, or the sky would shift the day it was
// swapped in -- so that agreement is checked across the whole sphere first.

const DEG = Math.PI / 180;
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const vclose = (a, b, eps, msg) => {
  for (let i = 0; i < 3; i++) close(a[i], b[i], eps, `${msg}[${i}]`);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// In degrees. acos is ill-conditioned near 1 -- a rounding error of 1e-15 in
// the dot product reads as a few millionths of a degree -- so "exact" below
// means within 1e-4 degrees, a third of an arcsecond.
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;

// The drag, exactly as app.js performs it: the finger's direction in the
// screen's own frame, the view's current altitude as the branch hint, the
// shared limits.
const SCREEN = basisOf(IDENTITY);
const focal = focalLength(900, 65);
const drag = (q, grabbed, px, py, floor = -89, ceiling = 89) =>
  upright(clampAltitude(
    aimLevel(grabbed, screenToVector(px, py, SCREEN, focal), q, floor, ceiling),
    floor, ceiling));

// --- the algebra ------------------------------------------------------------------

test('the identity rotates nothing, and inverses undo', () => {
  vclose(rotate(IDENTITY, [0.3, -0.5, 0.8]), [0.3, -0.5, 0.8], 1e-12, 'identity');
  const q = normalize([0.3, 0.5, -0.2, 0.7]);
  const v = [0.6, -0.48, 0.64];
  vclose(rotate(conjugate(q), rotate(q, v)), v, 1e-12, 'q then q-inverse');
});

test('rotation preserves length and angles', () => {
  const q = normalize([0.2, -0.6, 0.3, 0.71]);
  const a = [1, 0, 0], b = [0, 0, 1];
  const ra = rotate(q, a), rb = rotate(q, b);
  close(Math.hypot(...ra), 1, 1e-12, 'length');
  close(dot(ra, rb), dot(a, b), 1e-12, 'angle between');
});

test('composition is the same as rotating twice, in the same order', () => {
  const a = fromAxisAngle([0, 0, 1], 0.7), b = fromAxisAngle([1, 0, 0], -0.4);
  const v = [0.2, 0.9, -0.3];
  vclose(rotate(mul(b, a), v), rotate(b, rotate(a, v)), 1e-12, 'b*a applies a first');
});

test('a basis round-trips through fromBasis, whichever branch it takes', () => {
  // Shepperd's method has four branches, chosen by which diagonal term is
  // largest. Each is reached by a different orientation; a half-turn about
  // each axis lands squarely in a non-trace branch, which is where the
  // naive single-branch version produces NaN.
  const fixtures = [
    IDENTITY, fromAim(45, 30), fromAim(200, -60),
    fromAxisAngle([1, 0, 0], Math.PI), fromAxisAngle([0, 1, 0], Math.PI), fromAxisAngle([0, 0, 1], Math.PI),
    fromAxisAngle([1, 1, 0], 2.9), fromAxisAngle([0, 1, 1], -2.9),
  ];
  for (const q of fixtures) {
    const b = basisOf(q);
    const back = basisOf(fromBasis(b.right, b.forward, b.up));
    vclose(back.right, b.right, 1e-9, 'right');
    vclose(back.forward, b.forward, 1e-9, 'forward');
    vclose(back.up, b.up, 1e-9, 'up');
  }
});

// --- agreement with the angles it replaces -------------------------------------------

test('fromAim reproduces basisFromAim across the whole sphere', () => {
  // If this drifts, the sky moves the day the quaternion is swapped in.
  for (let az = 0; az < 360; az += 15) {
    for (let alt = -85; alt <= 85; alt += 5) {
      const q = basisOf(fromAim(az, alt));
      const b = basisFromAim(az, alt);
      vclose(q.forward, b.forward, 1e-9, `forward at ${az},${alt}`);
      vclose(q.right, b.right, 1e-9, `right at ${az},${alt}`);
      vclose(q.up, b.up, 1e-9, `up at ${az},${alt}`);
    }
  }
});

test('the identity is due north and level, so a fresh view needs no rotation', () => {
  const b = basisOf(IDENTITY);
  vclose(b.forward, altAzToVector(0, 0), 1e-12, 'forward');
  const { az, alt } = vectorToAltAz(b.forward);
  close(az, 0, 1e-9, 'az'); close(alt, 0, 1e-9, 'alt');
});

test('altitudeOf agrees with the angle the readout uses', () => {
  for (const [az, alt] of [[0, 0], [123, 45], [270, -60], [30, 89], [200, -89]]) {
    close(altitudeOf(fromAim(az, alt)), alt, 1e-9, `alt at ${az},${alt}`);
  }
});

test('the basis stays finite and orthonormal AT the poles', () => {
  // basisFromAim could not be asked for 90: it clamped to 89.9 because the
  // cross products collapse. This has nothing to collapse.
  for (const alt of [89.9, 90, -90, 89.999]) {
    const b = basisOf(fromAim(0, alt));
    for (const v of [b.right, b.up, b.forward]) {
      assert.ok(Number.isFinite(v[0] + v[1] + v[2]), `not finite at alt ${alt}`);
      close(Math.hypot(...v), 1, 1e-9, `unit at alt ${alt}`);
    }
    close(dot(b.right, b.up), 0, 1e-9, `right.up at ${alt}`);
    close(dot(b.right, b.forward), 0, 1e-9, `right.fwd at ${alt}`);
    close(dot(b.up, b.forward), 0, 1e-9, `up.fwd at ${alt}`);
  }
});

// --- level, by construction ---------------------------------------------------------

test('upright takes the roll out entirely and leaves the aim alone', () => {
  const q = fromAim(30, 20);
  const rolled = mul(fromAxisAngle(basisOf(q).forward, 12 * DEG), q);
  assert.ok(Math.abs(basisOf(rolled).right[2]) > 0.1, 'the fixture should be rolled');
  const after = basisOf(upright(rolled));
  close(after.right[2], 0, 1e-12, 'right must be exactly horizontal');
  vclose(after.forward, basisOf(rolled).forward, 1e-12, 'levelling must not re-aim');
  vclose(after.right, basisOf(q).right, 1e-9, 'and lands on the basis the angles would give');
});

test('upright is a no-op on a view that is already level, and at the pole', () => {
  const q = fromAim(210, -40);
  vclose(basisOf(upright(q)).up, basisOf(q).up, 1e-12, 'level in, level out');
  const pole = fromAim(0, 90);
  const rolled = mul(fromAxisAngle(basisOf(pole).forward, 0.5), pole);
  assert.deepEqual(upright(rolled), rolled, 'there is no level horizon to find at the zenith');
});

// --- the drag: solved, not searched for ---------------------------------------------

test('a drag lands the grabbed direction exactly under the finger, in one step', () => {
  // The old solver iterated six times and kept its best miss. This is exact
  // wherever a level view can show the point at all -- including near the
  // nadir, where the old one would give up and not move.
  for (const [az, alt] of [[0, 0], [45, 60], [200, -80], [10, -85], [300, 70]]) {
    const q = fromAim(az, alt);
    const grabbed = screenToVector(120, -80, basisOf(q), focal);
    const after = drag(q, grabbed, -40, 30);
    const landed = screenToVector(-40, 30, basisOf(after), focal);
    const miss = angleBetween(landed, grabbed);
    assert.ok(miss < 1e-4, `missed by ${miss} degrees at ${az},${alt}`);
    close(basisOf(after).right[2], 0, 1e-12, `and the horizon is level at ${az},${alt}`);
  }
});

test('grab, move, put back: the view is exactly where it started', () => {
  // THE DRIFT, as geometry. A drag that does not round-trip is a drag that
  // moved the view somewhere the finger did not ask for. The angle solver
  // missed by 5 degrees near the nadir; the trackball, by 25 near the zenith.
  // The move is always AWAY from the nearer pole, because a drag that leans
  // on a limit is allowed to lose the star -- that is the limit working.
  for (const alt of [0, 45, -45, -77, -85, 85]) {
    const s = alt > 0 ? -1 : 1;                 // which way is away from the pole
    const q0 = fromAim(0, alt);
    let q = q0;
    let g = screenToVector(120, -80 * s, basisOf(q), focal);
    q = drag(q, g, -40, 30 * s);
    g = screenToVector(-40, 30 * s, basisOf(q), focal);
    q = drag(q, g, 120, -80 * s);
    const err = angleBetween(basisOf(q).forward, basisOf(q0).forward);
    assert.ok(err < 1e-4, `round trip missed by ${err} degrees at ${alt}`);
  }
});

test('dragging straight up climbs all the way to the ceiling -- no wall short of it', () => {
  // THE REPORTED WALL. It sat at 71 degrees with the limit at 89, because a
  // step whose answer the angles could not hold was refused whole. Five
  // full-screen drags from 30 must arrive at 89 and stay there.
  let q = fromAim(0, 30);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const g = screenToVector(0, -300, basisOf(q), focal);   // a star near the top
    q = drag(q, g, 0, 300);                                  // pulled to the bottom
    seen.push(Math.round(altitudeOf(q)));
  }
  assert.ok(seen.every((a, i) => i === 0 || a >= seen[i - 1]),
    `must never lose height: ${seen.join(' -> ')}`);
  assert.equal(seen[seen.length - 1], 89, `must reach the ceiling: ${seen.join(' -> ')}`);
  assert.ok(seen[1] > 71, `the old wall was at 71: ${seen.join(' -> ')}`);
});

test('dragging a planet up and down, off centre, never jumps and comes back exactly', () => {
  // THE REPORTED FLIP-FLOP, as two numbers. Grab a planet 200px right of
  // centre and run the finger up 150px and back down, in 30 steps each way.
  // A flip-flop is a frame where the view moved by far more than the finger
  // did: the old solver jumped 4.5 degrees for a 0.4 degree finger step
  // near the nadir. And when the finger is back where it grabbed, the view
  // must be back where it started -- at the Sun's night-time altitude, and
  // pinned against the floor, where the wrong branch used to win.
  const step = Math.atan(5 / focal) / DEG;              // one finger step, in degrees
  for (const alt of [20, -59, -77, -85]) {
    let q = fromAim(90, alt);
    const start = basisOf(q).forward;
    const g = screenToVector(200, 0, basisOf(q), focal);
    let prev = start, worst = 0;
    for (let i = 1; i <= 60; i++) {
      const dy = i <= 30 ? -5 * i : -150 + 5 * (i - 30);
      q = drag(q, g, 200, dy);
      const f = basisOf(q).forward;
      worst = Math.max(worst, angleBetween(prev, f));
      close(basisOf(q).right[2], 0, 1e-12, `horizon level at ${alt}, step ${i}`);
      prev = f;
    }
    assert.ok(worst <= step * 1.05, `the view jumped ${worst.toFixed(2)} degrees for a ${step.toFixed(2)} degree finger step at ${alt}`);
    const back = angleBetween(start, prev);
    assert.ok(back < 1e-4, `finger back at the start, view ${back.toFixed(3)} degrees away, at ${alt}`);
  }
});

test('out of reach means the nearest view, never no view and never NaN', () => {
  // A star at 60 up cannot sit 45 degrees right of centre in a level view.
  // The old solver would refuse the step; this leans as far as it can.
  const star = [0, Math.cos(60 * DEG), Math.sin(60 * DEG)];   // due north, 60 up
  const wide = focalLength(900, 90);           // 45 degrees to the edge
  const d = screenToVector(450, 0, SCREEN, wide);
  const after = aimLevel(star, d, fromAim(0, 30));
  assert.ok(after, 'a view must come back');
  const b = basisOf(after);
  assert.ok(Number.isFinite(b.forward[0] + b.forward[1] + b.forward[2]), 'finite');
  close(b.right[2], 0, 1e-12, 'level');
  // ...and it is the view that puts the star as close to the finger as a
  // level view can: on the same side, high up.
  const shown = vectorToAltAz(screenToVector(450, 0, b, wide));
  assert.ok(shown.alt > 40, `should have leaned toward the star, showing ${shown.alt}`);
  assert.ok(!aimLevel(star, [1, 0, 0], fromAim(0, 30)), 'a direction with no forward is not a screen point');
});

test('pinned at a limit and dragged further, the view holds still -- it does not spin', () => {
  // FOUND IN A BROWSER. At 89, every further upward drag turned the sky
  // round by 180 degrees: the over-the-pole answer was three degrees nearer
  // in ALTITUDE and was being chosen for it. Nearer in direction is what
  // continuity means. Same at the floor.
  for (const [alt, dy0, dy1] of [[89, -300, 300], [-89, 300, -300]]) {
    let q = fromAim(45, alt);
    for (let i = 0; i < 4; i++) {
      const g = screenToVector(0, dy0, basisOf(q), focal);
      q = drag(q, g, 0, dy1);
      const { az } = vectorToAltAz(basisOf(q).forward);
      close(((az - 45 + 540) % 360) - 180, 0, 1e-6, `azimuth after drag ${i} at ${alt}`);
      close(altitudeOf(q), alt, 1e-9, `altitude after drag ${i} at ${alt}`);
    }
    // And it comes back down the same side it went up: a drag the other way
    // from the pinned view must land below the limit, at the same azimuth.
    const g = screenToVector(0, dy1, basisOf(q), focal);
    q = drag(q, g, 0, dy0);
    const { az } = vectorToAltAz(basisOf(q).forward);
    close(((az - 45 + 540) % 360) - 180, 0, 1e-6, `azimuth on the way back from ${alt}`);
    assert.ok(Math.abs(altitudeOf(q)) < 60, `should have come well off the limit from ${alt}: ${altitudeOf(q)}`);
  }
});

test('the limits hold the drag, from every direction', () => {
  // Down past the floor, up past the ceiling, and the view stays a degree
  // clear of both poles where the readout has no azimuth to give.
  let q = fromAim(180, -60);
  for (let i = 0; i < 6; i++) q = drag(q, screenToVector(0, 300, basisOf(q), focal), 0, -300);
  close(altitudeOf(q), -89, 1e-9, 'floor');
  q = fromAim(180, 60);
  for (let i = 0; i < 6; i++) q = drag(q, screenToVector(0, -300, basisOf(q), focal), 0, 300);
  close(altitudeOf(q), 89, 1e-9, 'ceiling');
  // And a tighter floor is honoured too: the limits are arguments, not
  // constants baked in.
  q = fromAim(0, 0);
  for (let i = 0; i < 4; i++) q = drag(q, screenToVector(0, 300, basisOf(q), focal), 0, -300, -30, 89);
  close(altitudeOf(q), -30, 1e-9, 'a floor passed in is a floor honoured');
});

// --- the limit is a lean ------------------------------------------------------------------

test('clampAltitude turns the view back by exactly the excess, and keeps the azimuth', () => {
  for (const [alt, ceiling, want] of [[60, 45, 45], [88, 89, 88], [95, 89, 85], [120, 89, 60]]) {
    // fromAim past 90 is an aim OVER the pole: 95 is 85 facing the other way,
    // and is already inside the limit.
    close(altitudeOf(clampAltitude(fromAim(40, alt), -89, ceiling)), want, 1e-9, `alt ${alt}`);
  }
  for (const [alt, floor, want] of [[-60, -30, -30], [-88, -89, -88], [-95, -89, -85]]) {
    close(altitudeOf(clampAltitude(fromAim(40, alt), floor, 89)), want, 1e-9, `alt ${alt}`);
  }
  const { az } = vectorToAltAz(basisOf(clampAltitude(fromAim(40, 60), -89, 45)).forward);
  close(az, 40, 1e-6, 'the azimuth must survive the clamp');
  // SOLVED, NOT ASSUMED. Past the pole the same turn moves altitude the
  // other way; asking for -30 from a view that had gone over used to give -40.
  close(altitudeOf(clampAltitude(fromAim(0, -95), -30, 89)), -30, 1e-9, 'past the pole');
});

// --- travelling --------------------------------------------------------------------------

test('slerp starts where it starts, ends where it ends, and takes the short way', () => {
  const a = fromAim(350, 10), b = fromAim(10, 20);
  vclose(basisOf(slerp(a, b, 0)).forward, basisOf(a).forward, 1e-9, 't=0');
  vclose(basisOf(slerp(a, b, 1)).forward, basisOf(b).forward, 1e-9, 't=1');
  // Across the 360 seam: the midpoint must be near azimuth 0, not near 180.
  const mid = vectorToAltAz(basisOf(slerp(a, b, 0.5)).forward);
  assert.ok(Math.abs(((mid.az + 180) % 360) - 180) < 20, `went the long way: ${mid.az}`);
});

test('slerp is smooth even between nearly identical rotations', () => {
  // The near-parallel branch: a naive acos there divides by a sine of zero.
  const a = fromAim(12, 34);
  const b = mul(fromAxisAngle([0, 0, 1], 1e-7), a);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const f = basisOf(slerp(a, b, t)).forward;
    assert.ok(Number.isFinite(f[0] + f[1] + f[2]), `NaN at t=${t}`);
  }
});

test('a quaternion stays unit and level through a long chain of drags', () => {
  // Drift stretches the sky by a fraction of a percent per hundred drags if
  // nothing normalises; and sixty off-centre drags left the trackball's
  // horizon thirteen degrees off. Five hundred here.
  let q = fromAim(0, 0);
  for (let i = 0; i < 500; i++) {
    const g = screenToVector(180, -60, basisOf(q), focal);
    q = drag(q, g, 140, 20);
  }
  close(Math.hypot(...q), 1, 1e-9, 'still unit after 500 drags');
  close(basisOf(q).right[2], 0, 1e-12, 'still level after 500 drags');
});
