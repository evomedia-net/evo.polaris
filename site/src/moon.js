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
