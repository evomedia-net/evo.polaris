// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// The Moon: where it is, and how much of it is lit.
//
// This matters more than it looks for the job this app does. The Moon is the
// brightest thing that will ruin a deep-sky exposure, so "is it up, and how
// full is it" decides whether tonight is worth setting up for at all. A
// gibbous Moon thirty degrees from your target is a washed-out frame no
// tracking accuracy can rescue.
//
// UNLIKE THE ISS, THIS IS COMPUTED, NOT FETCHED. The Moon's motion is known
// centuries ahead, so it needs no network and works in a field with the radio
// off, which is the rest of this app's promise.
//
// ACCURACY, STATED HONESTLY. This is the truncated lunar theory -- the handful
// of largest periodic terms out of the hundreds in the full series. It is good
// to roughly a quarter of a degree in position, which is about half the Moon's
// own width: ample for "look south-east, forty degrees up", useless for
// predicting an occultation. The illuminated fraction is far better than the
// position, because it depends on the Sun-Moon angle rather than on either
// body's exact place.

import { julianDay, lstHours, equatorialToHorizontal, riseSetOnDay } from './astro.js';

const DEG = Math.PI / 180;

function daysSinceJ2000(date) {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}

/** Obliquity of the ecliptic, degrees. */
function obliquity(d) {
  return 23.4393 - 3.563e-7 * d;
}

/** The Sun's geometric ecliptic longitude, degrees -- needed for the phase. */
export function sunEclipticLongitude(date) {
  const d = daysSinceJ2000(date);
  const L = 280.460 + 0.9856474 * d;
  const g = (357.528 + 0.9856003 * d) * DEG;
  return ((L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360 + 360) % 360;
}

// THE MOON'S SERIES, FROM MEEUS (Astronomical Algorithms, 2nd ed., ch. 47).
//
// It used to be the six largest longitude terms and four latitude terms,
// good to about a third of a degree -- fine for a phase and a rise time, and
// not fine for a ring drawn round the Moon: checked against JPL Horizons it
// missed by 0.15 to 0.34 degrees even once corrected for where you stand
// (#263), most of a Moon-width. These are Meeus's tables 47.A and 47.B, the
// truncated ELP-2000/82 he gives, with his three additive corrections and
// the eccentricity factor E on every term that carries the Sun's anomaly.
// Each row is [D, M, M', F, coefficient(s)], units of 1e-6 degree for
// longitude and latitude and 1e-3 km for distance.
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

/**
 * The Moon's position: ecliptic longitude and latitude of date, right
 * ascension, declination and distance. Geocentric -- see topocentricMoon().
 */
export function moonPosition(date) {
  const d = daysSinceJ2000(date);
  const T = d / 36525;

  // Mean elements, degrees (Meeus 47.1-47.5).
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = (297.8501921 + 445267.1114034 * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const F = (93.2720950 + 483202.0175233 * T) * DEG;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const A1 = (119.75 + 131.849 * T) * DEG;
  const A2 = (53.09 + 479264.290 * T) * DEG;
  const A3 = (313.45 + 481266.484 * T) * DEG;

  let sl = 0, sr = 0, sb = 0;
  for (const [dD, dM, dMp, dF, cl, cr] of MOON_LR) {
    const arg = dD * D + dM * M + dMp * Mp + dF * F;
    const e = dM === 0 ? 1 : (Math.abs(dM) === 1 ? E : E * E);
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [dD, dM, dMp, dF, cb] of MOON_B) {
    const arg = dD * D + dM * M + dMp * Mp + dF * F;
    const e = dM === 0 ? 1 : (Math.abs(dM) === 1 ? E : E * E);
    sb += cb * e * Math.sin(arg);
  }
  const LpR = Lp * DEG;
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F)
    + 175 * Math.sin(A1 + F) + 127 * Math.sin(LpR - Mp) - 115 * Math.sin(LpR + Mp);

  const lon = Lp + sl / 1e6;
  const lat = sb / 1e6;
  const distanceKm = 385000.56 + sr / 1000;

  const l = ((lon % 360) + 360) % 360;
  const lam = l * DEG, bet = lat * DEG, eps = obliquity(d) * DEG;

  // Ecliptic to equatorial.
  const ra = Math.atan2(
    Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps),
    Math.cos(lam),
  );
  const dec = Math.asin(
    Math.sin(bet) * Math.cos(eps)
    + Math.cos(bet) * Math.sin(eps) * Math.sin(lam),
  );

  return {
    eclipticLon: l,
    eclipticLat: lat,
    ra: ((ra / DEG) % 360 + 360) % 360,
    dec: dec / DEG,
    distanceKm,
  };
}

/**
 * The Moon as seen from where you stand, not from the centre of the Earth.
 *
 * WHY THIS EXISTS (#263). moonPosition() is geocentric, and the Moon is close
 * enough for that to matter: its horizontal parallax is about 0.95 degrees,
 * so from the surface it sits up to that much LOWER than the geocentric
 * position -- nearly two Moon-widths at the horizon, half that overhead.
 * moonRiseSet() already allowed for it (MOONRISE_ALT, below); the sky view
 * did not, and checked against JPL Horizons its ring missed the Moon by
 * 0.24 to 0.83 degrees while the Sun and every planet were within 0.08.
 *
 * Meeus, Astronomical Algorithms, ch. 11 (the observer's geocentric
 * position on the WGS84-ish ellipsoid) and ch. 40 (the rigorous shift in
 * right ascension and declination). The planets and the Sun are far enough
 * away that the same shift is under 0.01 degree, so they are left alone.
 *
 * @param {{ra:number, dec:number, distanceKm:number}} pos  geocentric, degrees
 * @param {number} lstH    local sidereal time, hours
 * @param {number} latDeg  geodetic latitude
 * @param {number} [heightM=0]  height above sea level, metres
 * @returns {{ra:number, dec:number}} topocentric, degrees
 */
export function topocentricMoon(pos, lstH, latDeg, heightM = 0) {
  const phi = latDeg * DEG;
  // The observer's geocentric latitude and distance from the centre, in
  // Earth radii (Meeus 11.1): 0.99664719 is the polar-to-equatorial ratio.
  const u = Math.atan(0.99664719 * Math.tan(phi));
  const h = heightM / 6378140;
  const rhoSin = 0.99664719 * Math.sin(u) + h * Math.sin(phi);
  const rhoCos = Math.cos(u) + h * Math.cos(phi);
  const sinPi = 6378.14 / pos.distanceKm;           // equatorial horizontal parallax
  const ra = pos.ra * DEG, dec = pos.dec * DEG;
  const H = (lstH * 15) * DEG - ra;                  // hour angle
  // Meeus 40.2 and 40.3.
  const dRa = Math.atan2(-rhoCos * sinPi * Math.sin(H),
                         Math.cos(dec) - rhoCos * sinPi * Math.cos(H));
  const decTopo = Math.atan2((Math.sin(dec) - rhoSin * sinPi) * Math.cos(dRa),
                             Math.cos(dec) - rhoCos * sinPi * Math.cos(H));
  return {
    ra: (((ra + dRa) / DEG) % 360 + 360) % 360,
    dec: decTopo / DEG,
  };
}

/**
 * The Sun's equatorial position -- right ascension and declination.
 *
 * Needed for two things the ecliptic longitude alone cannot give: the angle of
 * the Moon's bright limb, and telling whether a planet is lost in twilight.
 * The Sun's ecliptic latitude is zero by definition, which is what makes this
 * a one-line rotation rather than a second series.
 */
export function sunEquatorial(date) {
  const d = daysSinceJ2000(date);
  const lam = sunEclipticLongitude(date) * DEG;
  const eps = obliquity(d) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  return { ra: ((ra / DEG) % 360 + 360) % 360, dec: dec / DEG };
}

/**
 * The position angle of the Moon's bright limb, degrees east of north.
 *
 * WHAT THIS IS FOR: a crescent does not sit with its horns pointing wherever
 * you like. The lit edge always faces the Sun, and drawing it any other way
 * produces a picture that is wrong in a way people notice instantly without
 * being able to say why. Low in the west after sunset the crescent leans one
 * way; the same phase in the east before dawn leans the other.
 *
 * Measured from celestial north through east, which is the convention every
 * ephemeris uses for a position angle.
 */
export function brightLimbAngle(moon, sun) {
  const dRa = (sun.ra - moon.ra) * DEG;
  const sd = sun.dec * DEG, md = moon.dec * DEG;
  const y = Math.cos(sd) * Math.sin(dRa);
  const x = Math.sin(sd) * Math.cos(md) - Math.cos(sd) * Math.sin(md) * Math.cos(dRa);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

const SYNODIC = 29.530588853;     // days from one new Moon to the next

/**
 * How much of the Moon is lit, which way it is going, and what to call it.
 *
 * The illuminated fraction comes from the Sun-Moon elongation rather than from
 * a count of days, so it stays right through the irregularities that make the
 * "age in days" figure only approximate.
 */
export function moonPhase(date) {
  const moon = moonPosition(date);
  const sunLon = sunEclipticLongitude(date);

  // Elongation along the ecliptic, 0 at new and 180 at full.
  const elong = ((moon.eclipticLon - sunLon) % 360 + 360) % 360;
  const illuminated = (1 - Math.cos(elong * DEG)) / 2;
  const waxing = elong < 180;
  const age = (elong / 360) * SYNODIC;

  let name;
  if (illuminated < 0.02) name = 'New Moon';
  else if (illuminated > 0.98) name = 'Full Moon';
  else if (Math.abs(illuminated - 0.5) < 0.03) {
    name = waxing ? 'First Quarter' : 'Last Quarter';
  } else if (illuminated < 0.5) {
    name = waxing ? 'Waxing Crescent' : 'Waning Crescent';
  } else {
    name = waxing ? 'Waxing Gibbous' : 'Waning Gibbous';
  }

  return { illuminated, waxing, age, elongation: elong, name, ...moon };
}

/**
 * The phase, in the few words the ring's label has room for (#264).
 *
 * Kelly, with a screenshot of the ring round an all-but-unlit disc labelled
 * just "Moon": "'missing' moon should label all stages it goes through, but
 * for sure 'dark side' as it looks like moon is missing". At new moon the
 * half facing us is the unlit half, so the words say exactly that; every
 * other stage gets its name and how much of it is lit.
 *
 *   new, dark side facing us        waxing crescent, 12% lit
 *   first quarter, 50% lit          waxing gibbous, 81% lit
 *   full, 100% lit                  waning gibbous / last quarter / waning crescent
 */
export function moonPhaseWords(phase) {
  if (phase.illuminated < 0.02) return 'new, dark side facing us';
  const name = phase.name.replace(/ Moon$/, '').toLowerCase();
  return `${name}, ${Math.round(phase.illuminated * 100)}% lit`;
}

/**
 * One sentence on whether the Moon is going to be a problem tonight.
 *
 * A Moon below the horizon does not matter however full it is, and a thin
 * crescent barely matters even when it is up -- so the altitude and the
 * fraction are judged together rather than separately.
 */
export function describeMoon(phase, altDeg) {
  const pct = Math.round(phase.illuminated * 100);
  if (altDeg < -0.5) {
    return `${phase.name}, ${pct}% lit — below the horizon, so it will not `
      + 'spoil anything right now.';
  }
  const where = `${altDeg.toFixed(0)}° up`;
  if (pct < 15) {
    return `${phase.name}, ${pct}% lit and ${where}. Thin enough to ignore.`;
  }
  if (pct < 50) {
    return `${phase.name}, ${pct}% lit and ${where}. Keep your target well away `
      + 'from it.';
  }
  return `${phase.name}, ${pct}% lit and ${where}. Bright enough to wash out `
    + 'faint targets — worth waiting for it to set.';
}

// --- when it rises and when it sets -----------------------------------------
//
// THE ALTITUDE AT MOONRISE IS NOT ZERO, AND IT IS NOT NEGATIVE EITHER.
//
// For a star, rise is the centre at -0.5667 degrees: refraction lifts it over
// the horizon before it is geometrically there. For the Sun, -0.8333, adding
// its own half-degree radius. The Moon goes the other way, and this is the
// trap: it is close enough that PARALLAX matters. Seen from the surface rather
// than from the centre of the Earth it sits about 0.95 degrees LOWER than the
// geocentric position this module computes -- more than refraction and
// semidiameter together lift it. Meeus gives
//
//     h0 = 0.7275 * parallax - 0.5667 degrees ~= +0.125 degrees
//
// so the geocentric centre must be slightly ABOVE the horizon at the moment
// the topocentric upper limb touches it. Using 0, or borrowing the Sun's
// -0.8333, puts every time out by several minutes in the same direction.
const MOONRISE_ALT = 0.125;

/** The Moon's geocentric altitude from one place at one instant. */
function altitudeAt(t, latDeg, lonDeg) {
  const m = moonPosition(t);
  return equatorialToHorizontal(m.ra, m.dec, lstHours(julianDay(t), lonDeg), latDeg).alt;
}

/**
 * Moonrise and moonset for the LOCAL DAY containing `date`.
 *
 * EITHER CAN BE NULL, AND THAT IS NOT AN ERROR. The Moon rises about fifty
 * minutes later each day, so roughly once a month a calendar day contains no
 * moonrise at all -- it rose at 23:5x yesterday and will rise at 00:4x
 * tomorrow. Inside the polar circles it can stay up or stay down for days.
 * Reporting a time for those days means inventing one.
 *
 * Accuracy is a few minutes: the position itself is a truncated series good to
 * about a quarter of a degree, and near the horizon the Moon's own motion is
 * slow, so a small position error becomes a larger time error. Good enough to
 * plan a night around, not good enough to time an occultation.
 */
export function moonRiseSet(date, latDeg, lonDeg, stepMinutes = 10) {
  // The walk and the bisection are riseSetOnDay's, shared with the Sun; what
  // is the Moon's own is the ephemeris and MOONRISE_ALT, and those are the two
  // things it hands over. Which side it stayed on comes back too: "it does not
  // rise today" is only half an answer, and up all day and down all day are
  // opposite pieces of news for anyone planning a photograph.
  return riseSetOnDay((t) => altitudeAt(t, latDeg, lonDeg), date,
    MOONRISE_ALT, stepMinutes);
}

/**
 * The rise and set times in words, in the reader's own clock.
 *
 * Every instant here is a Date -- an absolute moment, which is UTC underneath
 * -- and only toLocaleTimeString turns it into a wall clock. So the same
 * computation reads correctly whatever zone the browser is in, and a planned
 * night in another month still prints the times for the day it names.
 */
export function describeMoonTimes({ rise, set, day, alwaysUp }) {
  const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = day.toLocaleDateString([], {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  if (!rise && !set) {
    return alwaysUp
      ? `${date}: the Moon is above the horizon all day — it neither rises `
        + 'nor sets.'
      : `${date}: the Moon stays below the horizon all day — it does not rise.`;
  }
  // IN THE ORDER THEY HAPPEN, not rise-then-set. Within one calendar day the
  // Moon usually SETS first -- it rose the previous afternoon -- so listing
  // rise first printed "rises 3:52 PM, sets 1:13 AM" and read as though the
  // set followed the rise by nine hours backwards.
  const parts = [];
  if (rise) parts.push({ at: +rise, text: `rises ${clock(rise)}` });
  if (set) parts.push({ at: +set, text: `sets ${clock(set)}` });
  parts.sort((a, b) => a.at - b.at);
  const missing = !rise ? ' It does not rise again until tomorrow.'
    : (!set ? ' It does not set again until tomorrow.' : '');
  // THE CAVEAT TRAVELS WITH THE NUMBER. A time printed to the minute reads as
  // accurate to the minute, and this one is not: the position is a truncated
  // series good to about a quarter of a degree, and near the horizon the Moon
  // moves slowly enough that a small error in where it is becomes a larger one
  // in when it got there. Saying so in the docstring only tells the people who
  // read the source; saying it here tells the person planning the night.
  // The tolerance attaches to the TIMES, not to the end of the paragraph.
  // Appended last it produced "sets 11:19 AM. It does not rise again until
  // tomorrow. +/- a few minutes." -- a qualifier floating after a sentence it
  // has nothing to do with.
  return `${date}: ${parts.map((p) => p.text).join(', ')}, `
    + `± a few minutes.${missing}`;
}
