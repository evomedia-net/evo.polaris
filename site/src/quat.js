// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Where the view is pointing, as a rotation rather than as two angles.
//
// WHY THIS EXISTS. The aim used to be stored as {az, alt}, and a drag was
// solved by ITERATION: rotate the grabbed ray onto the finger, collapse the
// result to az/alt, rebuild a basis, measure the miss, try again -- six
// times, keeping the best answer. Two things were wrong with that, and
// neither was gimbal lock, though it looked like it from the outside.
//
//   1. A step whose answer the angles could not hold (past 89.9, the basis
//      builder's own fence) was refused WHOLE rather than taken partway. So
//      the view stopped a full drag-length short of the limit: a wall at 71
//      degrees up, with the limit at 89. Smaller drags crept higher, which
//      is how the cause was confirmed.
//   2. Near the poles the collapse moves the very target the iteration is
//      chasing -- two points a degree apart across the zenith differ by 180
//      degrees of azimuth -- so the "best answer" was often "do not move".
//
// The drag is now solved in CLOSED FORM (aimLevel): the level view that puts
// the grabbed direction under the finger is a two-unknown problem with an
// exact answer, and where there is no answer it gives the nearest one, so
// the view leans on its limit instead of stopping short of it.
//
// The orientation is held as a quaternion because that is the natural home
// for the rest: a glide is a slerp, which takes the short way round without
// anyone reasoning about the 360 seam; the altitude limit is a rotation
// about the view's own right axis, which slides along the limit rather than
// snapping to it; and "level" is a property the view has by construction,
// not one it is nudged back towards. Angles are derived from it for the two
// jobs that genuinely need angles -- telling the user where they are
// looking, and the limits -- and for nothing else.
//
// A TRACKBALL WAS TRIED FIRST AND REJECTED. Composing "rotate the grabbed ray
// onto the finger" as a free rotation is exact and singularity-free, and it
// rolls the horizon, because an off-centre drag legitimately carries twist.
// Taking the twist back out afterwards -- gently or exactly -- fights the
// drag: a grab-and-put-back round trip missed by degrees, and dragging a
// planet up and down near the nadir walked the azimuth by thirty. A sky view
// has a horizon; roll is not a freedom it has, so it is not a freedom the
// solver is given.
//
// CONVENTION. [w, x, y, z], scalar first. The world is the app's horizontal
// frame: x east, y north, z up. The identity quaternion is the view looking
// due north and level, which is (az 0, alt 0), so a fresh view needs no
// rotation at all. A quaternion here always maps the reference basis
//
//     right0 = east  [1, 0, 0]
//     up0    = up    [0, 0, 1]
//     fwd0   = north [0, 1, 0]
//
// onto the current one. Unit length is maintained by normalising after every
// composition: floating point drifts, and a drifting quaternion stretches the
// sky by a fraction of a percent per hundred drags.

const DEG = Math.PI / 180;

export const IDENTITY = [1, 0, 0, 0];

export function mul(a, b) {
  const [aw, ax, ay, az] = a, [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function normalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!l) return IDENTITY.slice();
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export const conjugate = (q) => [q[0], -q[1], -q[2], -q[3]];

/** A rotation of `rad` about `axis`, right-handed. The axis need not be unit. */
export function fromAxisAngle(axis, rad) {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  if (!l) return IDENTITY.slice();
  const h = rad / 2, s = Math.sin(h) / l;
  return [Math.cos(h), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** Rotate a vector by a quaternion. */
export function rotate(q, v) {
  const [w, x, y, z] = q;
  // t = 2 * (q.xyz cross v); v' = v + w*t + q.xyz cross t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx,
  ];
}

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The screen basis this rotation produces: right, up and forward. */
export function basisOf(q) {
  return {
    right: rotate(q, [1, 0, 0]),
    up: rotate(q, [0, 0, 1]),
    forward: rotate(q, [0, 1, 0]),
  };
}

/**
 * The rotation for an aim given the old way, in degrees.
 *
 * Turn about the world's up axis, then tilt about the view's own right axis.
 * The order matters and this one has no roll in it: the horizon comes out
 * level for every az and alt except exactly at the poles, where "level" has
 * no meaning.
 */
export function fromAim(azDeg, altDeg) {
  // Negative, because a positive turn about +z carries east toward north and
  // azimuth runs the other way -- north toward east.
  const yaw = fromAxisAngle([0, 0, 1], -azDeg * DEG);
  const right = rotate(yaw, [1, 0, 0]);
  return normalize(mul(fromAxisAngle(right, altDeg * DEG), yaw));
}

/** Altitude of what the view is pointing at, in degrees. */
export function altitudeOf(q) {
  return Math.asin(Math.max(-1, Math.min(1, rotate(q, [0, 1, 0])[2]))) / DEG;
}

/**
 * The roll-free rotation that points the same way.
 *
 * THE HORIZON IS LEVEL BY CONSTRUCTION, NOT BY CORRECTION. This is a sky
 * app: it draws a horizon, four cardinal points and a wireframe ground, and
 * there is no reading of "tilt your head" that any of those want. So the
 * view is not free to roll at all -- which means roll is not something to
 * damp back out afterwards, it is a degree of freedom that never existed.
 *
 * This is what makes a glide come out level at every frame: slerp between
 * two level views passes through views that are not quite level, by a
 * fraction of a degree, and the eye can see a horizon tilt that small.
 *
 * Built from the FORWARD VECTOR, never from az/alt. Deriving the angles and
 * rebuilding is the collapse this whole module exists to avoid; a cross
 * product with world up is the same projection without the singularity,
 * because it fails only exactly AT the pole, and the altitude clamp has
 * already kept the view a degree clear of it.
 */
export function upright(q) {
  const b = levelBasis(rotate(q, [0, 1, 0]));
  return b ? fromBasis(b.right, b.forward, b.up) : q;   // at a pole: no level to find
}

/**
 * The level basis looking along `f`: right along the horizon, up at right
 * angles to both. null only exactly at a pole, where |f x up| is zero.
 */
function levelBasis(f) {
  const r = cross(f, [0, 0, 1]);
  const s = Math.hypot(r[0], r[1], r[2]);      // = cos(altitude)
  if (s < 1e-9) return null;
  const right = [r[0] / s, r[1] / s, r[2] / s];
  return { right, forward: f, up: cross(right, f) };
}

/**
 * THE DRAG: the level view that puts the world direction `grabbed` under the
 * screen direction `d`.
 *
 * `d` is in the screen's own frame -- (right, forward, up) components, which
 * is what screenToVector returns when handed the identity basis. Two
 * unknowns, azimuth and altitude; two constraints, the screen point. Solved,
 * not searched for.
 *
 * ALTITUDE FIRST. In a level view at altitude t the screen direction sits at
 * height  b sin t + c cos t,  which is  R sin(t + phi)  with R = hypot(b, c)
 * and phi = atan2(c, b), and it has to equal the grabbed direction's height.
 * That inverts exactly and has two answers in general -- the same star at
 * the same screen height seen from either side of the zenith.
 *
 * THE ANSWER THAT CONTINUES THE CURRENT VIEW IS KEPT, and "continues" is
 * measured in the (azimuth, altitude) chart with the altitude UNCLAMPED.
 * Continuity is the entire feel of a drag, and two simpler measures were
 * tried and failed at the limits, both found in a browser:
 *
 *   - nearest altitude: pinned at 89 and dragged further up, the answer from
 *     the far side of the zenith was three degrees nearer in altitude and a
 *     hundred and eighty away in azimuth. The sky spun round on every drag.
 *   - nearest direction: at 89 every view is within two degrees of every
 *     other view, so the far-side answer, clamped back onto 89, looked as
 *     near as standing still -- and the view could never come down again.
 *
 * In the chart, an answer that has gone past the pole keeps its azimuth and
 * simply has an altitude past 90 -- so it is near the pinned view it came
 * from and far from its mirror image, which is the distinction the drag
 * needs. That answer is then clamped, on the side it came from: the
 * ALTITUDE is clamped and the azimuth is kept as solved. Re-deriving the
 * azimuth at the clamped altitude was the last flip found -- the derivation
 * changes sign across the pole, so the view pinned at 89 turned round by
 * 180 on every further drag upward.
 *
 * THEN AZIMUTH, which with the altitude fixed is a plain turn of the
 * horizontal components: (a, K) rotated by the azimuth lands on the grabbed
 * direction's (x, y), so the azimuth is the difference of their angles.
 *
 * OUT OF REACH IS THE NEAREST, NOT NOTHING. A star at 60 degrees cannot be
 * shown at a screen point 45 degrees right of centre in any level view --
 * the horizontal edge of a level screen never climbs that high -- and the
 * limits stop the view short of the poles. Either way the answer is the
 * closest altitude there is, so the view leans on the limit and the star
 * slides off the finger by exactly the amount it had to. The old solver
 * refused the whole step, which is where the wall came from.
 *
 * @param {number[]} grabbed  world direction under the finger at the start
 * @param {number[]} d        screen direction the finger is at now
 * @param {number[]} current  the view now, as a quaternion, to pick a branch
 */
export function aimLevel(grabbed, d, current, floorDeg = -89, ceilingDeg = 89) {
  const [a, b, c] = d;
  const [gx, gy, gz] = grabbed;
  const R = Math.hypot(b, c);
  if (R < 1e-12) return null;        // a screen direction with no forward or up: not a screen point
  const reach = Math.max(-1, Math.min(1, gz / R));
  const phi = Math.atan2(c, b);
  const base = Math.asin(reach);
  const lo = floorDeg * DEG, hi = ceilingDeg * DEG;
  const wrap = (t) => Math.atan2(Math.sin(t), Math.cos(t));
  const azimuthFor = (t) => Math.atan2(b * Math.cos(t) - c * Math.sin(t), a) - Math.atan2(gy, gx);
  // Where the view is now, in the chart.
  const now = rotate(current, [0, 1, 0]);
  const az0 = Math.atan2(now[0], now[1]);
  const t0 = Math.asin(Math.max(-1, Math.min(1, now[2])));
  let t = null, az = null, bestScore = Infinity;
  for (const raw of [wrap(base - phi), wrap(Math.PI - base - phi)]) {
    const rawAz = azimuthFor(raw);
    const dAz = wrap(rawAz - az0);
    const dT = raw - t0;
    const score = dAz * dAz + dT * dT;
    if (score < bestScore) { bestScore = score; t = raw; az = rawAz; }
  }
  t = Math.max(lo, Math.min(hi, t));
  const sa = Math.sin(t), ca = Math.cos(t);
  const lb = levelBasis([ca * Math.sin(az), ca * Math.cos(az), sa]);
  return lb ? fromBasis(lb.right, lb.forward, lb.up) : null;
}

/**
 * The rotation carrying the reference axes onto three given orthonormal ones.
 *
 * Shepperd's method: take the square root from whichever of the four
 * diagonal combinations is largest, because the other three are dividing by
 * something near zero exactly when this one is not. Picking the trace branch
 * unconditionally is the classic way to get a NaN out of a half-turn.
 */
export function fromBasis(right, forward, up) {
  // Columns of the rotation matrix: x goes to right, y to forward, z to up.
  const m = [
    [right[0], forward[0], up[0]],
    [right[1], forward[1], up[1]],
    [right[2], forward[2], up[2]],
  ];
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s];
  }
  return normalize(q);
}

/** Shortest-path interpolation, for travelling to a target. */
export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end = b;
  // A quaternion and its negation are the same rotation; taking the near one
  // stops a glide going the long way round.
  if (d < 0) { d = -d; end = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) {
    return normalize([
      a[0] + (end[0] - a[0]) * t, a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t, a[3] + (end[3] - a[3]) * t,
    ]);
  }
  const th = Math.acos(Math.max(-1, Math.min(1, d)));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return normalize([
    a[0] * wa + end[0] * wb, a[1] * wa + end[1] * wb,
    a[2] * wa + end[2] * wb, a[3] * wa + end[3] * wb,
  ]);
}

/**
 * Hold the view's altitude between two limits, as a rotation.
 *
 * The old clamp worked on the angle and then REBUILT the basis from it,
 * which is what threw the roll away and, in the drag solver, made a step
 * that would overshoot the limit get refused outright rather than taken
 * partway -- a wall a whole drag-length below the limit.
 *
 * This turns the view back about its own right axis by exactly the excess,
 * so it slides along the limit instead of stopping at it, and everything
 * else about the rotation survives. At the limit the view is level by
 * construction, which is the one place the old code and this one agree.
 */
export function clampAltitude(q, floorDeg, ceilingDeg) {
  const alt = altitudeOf(q);
  const want = Math.max(floorDeg, Math.min(ceilingDeg, alt));
  if (want === alt) return q;

  // SOLVED, NOT ASSUMED. Turning by (want - alt) about the right axis is
  // correct only while the view is on the near side of the pole; carry it
  // over the top -- which a quaternion drag is free to do -- and the same
  // turn moves altitude the other way. Asking for -30 from a view that had
  // gone past the nadir gave -40.
  //
  // Right is perpendicular to forward, so rotating forward about it traces
  // z(t) = A cos t + B sin t, with A the current height and B the height of
  // (right x forward). That is R sin(t + phi), which inverts exactly. Out of
  // the two solutions take the smaller turn: the limit is a wall to lean on,
  // not somewhere to be spun to.
  const b = basisOf(q);
  const A = b.forward[2];
  const B = b.right[0] * b.forward[1] - b.right[1] * b.forward[0];  // (right x forward).z
  const R = Math.hypot(A, B);
  const target = Math.sin(want * DEG);
  if (R < 1e-12 || Math.abs(target) > R + 1e-12) return q;   // unreachable: leave it
  const phi = Math.atan2(A, B);
  const base = Math.asin(Math.max(-1, Math.min(1, target / R)));
  const wrap = (t) => Math.atan2(Math.sin(t), Math.cos(t));   // to (-pi, pi]
  const candidates = [wrap(base - phi), wrap(Math.PI - base - phi)];
  const t = Math.abs(candidates[0]) <= Math.abs(candidates[1]) ? candidates[0] : candidates[1];
  return normalize(mul(fromAxisAngle(b.right, t), q));
}
