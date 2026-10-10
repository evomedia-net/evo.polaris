// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// The paths things move along, drawn on the sky.
//
// A planet is a dot among ten thousand dots. Its PATH is what tells you which
// dot it is and where it is going -- and for the Moon and the station it is
// the difference between "it is over there" and "it will cross that tree in
// twenty minutes", which is the question someone framing a photograph is
// actually asking.
//
// WHAT A TRACK IS HERE. Each body's position is computed at a series of
// INSTANTS and then all of them are placed against the CURRENT sidereal time.
// That is deliberate: it draws the path the body takes THROUGH THE STARS, on
// the star field as it is oriented right now. Recomputing the sky's rotation
// for each sample instead would draw where the body appears from the ground at
// each time, which is a spiral of the Earth's rotation and tells you nothing
// about the body.
//
// THE STATION IS THE EXCEPTION, and it is the only one that needs the network.
// Its path cannot be computed here -- see iss.js -- so it is asked for, and it
// is a ground track rather than a path among the stars: the station moves
// against the sky far faster than the sky turns, so each sample IS converted
// at its own instant.

import { moonPosition } from './moon.js';
import { planetPosition, PLANET_NAMES } from './planets.js';
import { equatorialToVector } from './skyview.js';
import { lstHours, julianDay } from './astro.js';

const DAY_MS = 86400000;

/**
 * Where the Moon runs among the stars, a fortnight either side of now.
 *
 * Half its orbit each way: enough to see the whole arc it sweeps and which
 * constellations it is about to pass through, without wrapping the line back
 * over itself.
 */
export function moonTrack(date, days = 14, stepDays = 0.5) {
  const out = [];
  for (let d = -days; d <= days; d += stepDays) {
    const t = new Date(date.getTime() + d * DAY_MS);
    const { ra, dec, distanceKm } = moonPosition(t);
    // The distance rides along so the sky view can correct the path for
    // where you stand, exactly as it does the disc (#263).
    out.push({ ra, dec, distanceKm, at: t });
  }
  return out;
}

/**
 * Where a planet runs, three months either side of now.
 *
 * Long enough for the retrograde loops to show -- which is the one thing a
 * planet's path does that a star's never does, and the reason the ancients
 * called them wanderers.
 */
export function planetTrack(name, date, days = 90, stepDays = 3) {
  const out = [];
  for (let d = -days; d <= days; d += stepDays) {
    const t = new Date(date.getTime() + d * DAY_MS);
    const { ra, dec } = planetPosition(name, t);
    out.push({ ra, dec, at: t });
  }
  return out;
}

/**
 * Turn a list of equatorial positions into directions in the observer's sky.
 *
 * One sidereal time for every sample -- see the note at the top. Points below
 * the horizon are kept, flagged rather than dropped, so the drawing code can
 * break the line at the horizon instead of joining across the ground.
 */
export function placeTrack(points, lstH, latDeg, precess = null) {
  return points.map((p) => {
    const v = equatorialToVector(p.ra, p.dec, lstH, latDeg, precess);
    return { v, up: v[2] > 0, at: p.at };
  });
}

/**
 * The station's path: each sample at its OWN sidereal time.
 *
 * It crosses the sky in minutes, so the Earth's rotation during a pass is not
 * a rounding error -- it is most of the motion. Samples come from the tracker
 * (iss.js), which propagates the orbit; nothing here does.
 */
export function placeIssTrack(samples, site, lonDeg, latDeg) {
  return samples.map((s) => {
    const lst = lstHours(julianDay(s.at), lonDeg);
    // A satellite is close enough that its direction depends on where you are
    // standing, not only on which way the Earth is pointed -- so this goes
    // through the same look-angle geometry a pass prediction would, in iss.js.
    return { look: s.look, at: s.at, up: s.look.alt > 0, lst };
  });
}

/** Every planet's path, for the ones worth drawing. */
export function allPlanetTracks(date, days = 90, stepDays = 3) {
  return PLANET_NAMES.map((name) => ({
    name, points: planetTrack(name, date, days, stepDays),
  }));
}
