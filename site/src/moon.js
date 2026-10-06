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

/**
 * The Moon's position: ecliptic longitude and latitude, right ascension,
 * declination and distance.
 */
export function moonPosition(date) {
  const d = daysSinceJ2000(date);

  // Mean elements.
  const Lp = 218.316 + 13.176396 * d;        // mean longitude
  const M = (134.963 + 13.064993 * d) * DEG; // mean anomaly
  const F = (93.272 + 13.229350 * d) * DEG;  // argument of latitude
  const D = (297.850 + 12.190749 * d) * DEG; // mean elongation from the Sun
  const Ms = (357.529 + 0.98560028 * d) * DEG; // the Sun's mean anomaly

  // The largest periodic terms. The first is the equation of the centre; the
  // second is evection and the third variation -- the two corrections that
  // dominate what is left, and without which the error triples.
  const lon = Lp
    + 6.289 * Math.sin(M)
    + 1.274 * Math.sin(2 * D - M)
    + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * M)
    - 0.186 * Math.sin(Ms)
    - 0.114 * Math.sin(2 * F);

  const lat = 5.128 * Math.sin(F)
    + 0.281 * Math.sin(M + F)
    - 0.278 * Math.sin(F - M)
    - 0.173 * Math.sin(2 * D - F);

  const distanceKm = 385001
    - 20905 * Math.cos(M)
    - 3699 * Math.cos(2 * D - M)
    - 2956 * Math.cos(2 * D)
    - 570 * Math.cos(2 * M);

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
