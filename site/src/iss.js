// Where the International Space Station is, right now.
//
// THIS IS THE ONE FEATURE THAT CANNOT WORK OFFLINE, and that is worth stating
// plainly rather than discovering in a field. Stars are fixed for centuries
// and the magnetic model is good for five years, so both ship inside the app.
// The ISS is somewhere different every second and its orbit is nudged by drag
// and by reboosts, so its position cannot be bundled -- it has to be asked
// for. Everything else in this app keeps working with the radio off; this does
// not, and it says so instead of failing quietly.
//
// WHAT THIS DOES NOT DO: predict passes. "It rises in the north-west at 21:04
// for four minutes" is the genuinely useful thing for photography, and it
// needs SGP4 propagation from a fresh orbital element set -- an orbital
// mechanics library's worth of code, and elements that go stale in days.
// Showing where it is now is a fraction of that work and honest about being
// less. Pass prediction is a separate, much larger job.

const DEG = Math.PI / 180;

// WGS-84, the same ellipsoid the magnetic model uses.
const A = 6378.137;             // equatorial radius, km
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

/** Geodetic latitude, longitude and height to Earth-centred, Earth-fixed km. */
export function geodeticToEcef(latDeg, lonDeg, heightKm) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const s = Math.sin(lat), c = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);          // radius of curvature
  return [
    (n + heightKm) * c * Math.cos(lon),
    (n + heightKm) * c * Math.sin(lon),
    (n * (1 - E2) + heightKm) * s,
  ];
}

/**
 * Where a satellite appears from an observer: altitude, azimuth and range.
 *
 * Both positions are geodetic. The difference vector is rotated into the
 * observer's east/north/up frame, which is what "look up 40 degrees, turn to
 * 210" actually means.
 *
 * A NEGATIVE ALTITUDE IS NORMAL AND MUST BE REPORTED, not clamped: most of the
 * time the station is below the horizon, on the other side of the planet, and
 * an app that draws it anyway is inventing a sighting.
 */
export function lookAngles(observer, target) {
  const o = geodeticToEcef(observer.lat, observer.lon, observer.heightKm || 0);
  const t = geodeticToEcef(target.lat, target.lon, target.heightKm || 0);
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];

  const lat = observer.lat * DEG, lon = observer.lon * DEG;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const sLon = Math.sin(lon), cLon = Math.cos(lon);

  const east = -sLon * d[0] + cLon * d[1];
  const north = -sLat * cLon * d[0] - sLat * sLon * d[1] + cLat * d[2];
  const up = cLat * cLon * d[0] + cLat * sLon * d[1] + sLat * d[2];

  const range = Math.hypot(east, north, up);
  return {
    alt: Math.asin(up / range) / DEG,
    az: ((Math.atan2(east, north) / DEG) % 360 + 360) % 360,
    rangeKm: range,
    aboveHorizon: up > 0,
  };
}

/**
 * Ask where the station is. Requires the network, by nature.
 *
 * @param {function} [fetchFn] injectable for tests
 */
export async function fetchIss(fetchFn = fetch) {
  const res = await fetchFn('https://api.wheretheiss.at/v1/satellites/25544',
    { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') {
    throw new Error('no position in the response');
  }
  return {
    lat: d.latitude,
    lon: d.longitude,
    heightKm: d.altitude,
    // "eclipsed" means it is in the Earth's shadow: up, but unlit and
    // invisible. Drawing a marker without saying so sends someone outside to
    // look for a thing that is not shining.
    sunlit: d.visibility === 'daylight',
    visibility: d.visibility,
    velocityKmh: d.velocity,
    at: new Date((d.timestamp || Date.now() / 1000) * 1000),
  };
}

/** One sentence on whether it is worth going outside. */
export function describePass(look, iss) {
  if (!look.aboveHorizon) {
    return 'The ISS is below the horizon from here right now — it is on the '
      + 'other side of the Earth.';
  }
  const where = `${look.alt.toFixed(0)}° up, bearing ${look.az.toFixed(0)}°`;
  if (!iss.sunlit) {
    return `The ISS is above you (${where}) but in the Earth's shadow, so there `
      + 'is nothing to see — it only shines by reflected sunlight.';
  }
  return `The ISS is up and sunlit: ${where}, ${Math.round(look.rangeKm)} km away.`;
}
