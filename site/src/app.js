// evo.polaris -- app wiring.

import { alignmentSolution, julianDay, lstHours, solarNoon, sunNow } from './astro.js';
import { declination, modelValidity } from './geomag.js';
import { drawSkyChart, drawReticle } from './chart.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('polaris.' + k)) ?? d; }
              catch { return d; } },
  set(k, v) { try { localStorage.setItem('polaris.' + k, JSON.stringify(v)); }
              catch { /* private mode: preferences just don't persist */ } },
};

let stars = [];
let site = store.get('site', null);
let solution = null;
let compassOn = false;
let heading = null;          // true heading the phone is pointing, degrees
let lastOnTarget = false;

// --- appearance -------------------------------------------------------------

let scale = store.get('scale', 1);
let night = store.get('night', false);

function applyAppearance() {
  document.documentElement.style.setProperty('--scale', scale);
  document.documentElement.dataset.night = night ? 'on' : 'off';
  $('nightToggle').setAttribute('aria-pressed', String(night));
  render();
}

$('textBigger').onclick = () => {
  scale = Math.min(1.8, +(scale + 0.15).toFixed(2));
  store.set('scale', scale); applyAppearance();
};
$('textSmaller').onclick = () => {
  scale = Math.max(0.8, +(scale - 0.15).toFixed(2));
  store.set('scale', scale); applyAppearance();
};
$('nightToggle').onclick = () => {
  night = !night; store.set('night', night); applyAppearance();
};

// --- location ---------------------------------------------------------------

function setSite(next, note) {
  site = next;
  store.set('site', site);
  $('northCard').hidden = false;
  $('siteReadout').hidden = false;
  $('outLat').textContent = `${site.lat.toFixed(4)}° ${site.lat >= 0 ? 'N' : 'S'}`;
  $('outLon').textContent = `${site.lon.toFixed(4)}° ${site.lon >= 0 ? 'E' : 'W'}`;
  $('outAlt').textContent = Number.isFinite(site.altitude)
    ? `${Math.round(site.altitude)} m` : 'not supplied';
  $('locateStatus').textContent = note;
  $('settingsCard').hidden = false;
  $('findCard').hidden = false;
  render();
}

$('locateBtn').onclick = () => {
  if (!navigator.geolocation) {
    $('locateStatus').textContent =
      'This browser has no location service. Enter your position by hand below.';
    $('manualEntry').hidden = false;
    return;
  }
  $('locateStatus').textContent = 'Asking for your location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, altitude, accuracy } = pos.coords;
      setSite(
        { lat: latitude, lon: longitude, altitude: altitude ?? 0 },
        `Located to about ${Math.round(accuracy)} m.` +
        (altitude == null ? ' No altitude from GPS, assuming sea level.' : ''),
      );
    },
    (err) => {
      $('locateStatus').textContent =
        `Location unavailable (${err.message}). Enter it by hand below.`;
      $('manualEntry').hidden = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
};

$('manualToggle').onclick = () => {
  const box = $('manualEntry');
  box.hidden = !box.hidden;
  if (!box.hidden && site) {
    $('inLat').value = site.lat.toFixed(4);
    $('inLon').value = site.lon.toFixed(4);
    $('inAlt').value = Math.round(site.altitude || 0);
  }
};

// Altitude lookup. Deliberately a button rather than automatic: it is the only
// network call the app can make, and it carries the user's coordinates to a
// third party, so it happens when they ask and not before.
//
// It is a convenience, not an accuracy fix -- see the note it prints. The point
// is to spare anyone having to go and find their elevation and type it in.
$('lookupAlt').onclick = async () => {
  const lat = parseFloat($('inLat').value);
  const lon = parseFloat($('inLon').value);
  const note = $('lookupAltNote');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    note.textContent = 'Fill in latitude and longitude first.';
    return;
  }
  note.textContent = 'Looking up the ground elevation…';
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/elevation' +
      `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`,
      { mode: 'cors' },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const metres = Array.isArray(data.elevation) ? data.elevation[0] : null;
    if (!Number.isFinite(metres)) throw new Error('no elevation in response');

    $('inAlt').value = Math.round(metres);
    note.textContent =
      `Ground elevation about ${Math.round(metres)} m. For what it is worth, ` +
      'altitude shifts the magnetic declination by under 0.01° even at 3000 m, ' +
      'so this barely moves the numbers — it just saves you looking it up.';
  } catch (err) {
    note.textContent =
      `Could not reach the elevation service (${err.message}). Leave it blank — ` +
      'altitude changes the result by under 0.01°, so sea level is fine.';
  }
};

$('manualApply').onclick = () => {
  const lat = parseFloat($('inLat').value);
  const lon = parseFloat($('inLon').value);
  const alt = parseFloat($('inAlt').value);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    $('locateStatus').textContent = 'Latitude must be between −90 and 90.';
    return;                                    // fields keep their values
  }
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
    $('locateStatus').textContent = 'Longitude must be between −180 and 180.';
    return;
  }
  setSite({ lat, lon, altitude: Number.isFinite(alt) ? alt : 0 },
    'Using the position you typed.');
};

// --- the numbers ------------------------------------------------------------

function hemisphereNote() {
  return site && site.lat < 0
    ? 'You are in the southern hemisphere: the polar scope’s 60′–70′ circles ' +
      'and Sigma Octantis apply, not Polaris.'
    : '';
}

function render() {
  if (!site) return;
  const now = new Date();
  const dec = declination(site.lat, site.lon, (site.altitude || 0) / 1000, now);
  solution = alignmentSolution(now, site, dec);

  const latAbs = Math.abs(solution.latitudeSetting);
  $('outLatKnob').textContent =
    `${latAbs.toFixed(2)}°`;

  const compass = solution.trueNorthOnCompass;
  $('outCompass').textContent = `True north reads ${compass.toFixed(1)}°`;

  // --- finding true north without a compass --------------------------------
  // Polaris is within about half a degree of the pole, so pointing at it IS
  // pointing true north. Worth saying plainly: people assume they need north
  // first in order to find Polaris, when it works the other way round.
  $('outNorthStar').textContent =
    `Polaris is only ${solution.radiusArcmin.toFixed(0)}′ ` +
    `(${(solution.radiusArcmin / 60).toFixed(2)}°) from the true pole, so aiming ` +
    'at it is aiming true north. Use the chart in step 4 to find it — ' +
    'no compass, no declination, nothing to correct.';

  const noon = solarNoon(now, site.lon);
  // Name the zone. The time is rendered in the DEVICE's timezone, which is
  // right when you are standing at the coordinates and quietly wrong when you
  // are planning for somewhere else -- so say which clock this is.
  const noonTxt = noon.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  // Which way the noon shadow falls is NOT simply a hemisphere question: inside
  // the tropics the Sun passes north of the zenith for part of the year, and the
  // shadow flips with it. Read it off the computed position instead of guessing.
  const noonSun = sunNow(noon, site.lat, site.lon);
  const shadowNorth = Math.cos(noonSun.shadowAz * Math.PI / 180) > 0;
  const dir = shadowNorth ? 'north' : 'south';
  $('outSolarNoon').textContent = `Shadows point true ${dir} at ${noonTxt}`;

  const sun = sunNow(now, site.lat, site.lon);
  $('outSunNow').textContent =
    `At local solar noon the Sun crosses the meridian due ` +
    `${shadowNorth ? 'south' : 'north'}, so a vertical stick's shadow points ` +
    `exactly true ${dir} — mark that line and you have your axis. ` +
    (sun.up
      ? `Right now the Sun is ${sun.alt.toFixed(0)}° up at bearing ` +
        `${sun.az.toFixed(0)}°, with its shadow falling toward ` +
        `${sun.shadowAz.toFixed(0)}°.`
      : 'The Sun is below the horizon right now.');
  // For western declination these two numbers are always equal, so spell out
  // what each one means rather than printing the same figure twice.
  const dd = Math.abs(dec);
  $('outDeclination').textContent = dd < 0.05
    ? 'Your compass points at true north here — no correction needed.'
    : `Your compass needle points ${dd.toFixed(1)}° ${dec >= 0 ? 'east' : 'west'} ` +
      `of true north, so true north sits ${dd.toFixed(1)}° ` +
      `${dec >= 0 ? 'anticlockwise' : 'clockwise'} from the needle.`;

  const mins = solution.dialMinute;
  $('outDial').textContent =
    `${solution.dialHour}:${String(Math.round(mins)).padStart(2, '0')}`;
  $('outRadius').textContent =
    `On the 12-hour dial, at radius ${solution.radiusArcmin.toFixed(1)}′. ` +
    hemisphereNote();

  $('timeNote').textContent =
    `Good for ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. ` +
    'Polaris moves about one dial minute every two minutes — reset it if you take a break.';

  const rc = $('reticle');
  drawReticle(rc.getContext('2d'), {
    dialDecimal: solution.dialDecimal,
    radiusArcmin: solution.radiusArcmin,
    size: rc.width, night,
  });
  $('reticleDesc').textContent =
    `Polar scope reticle. Polaris goes at ${solution.dialHour} o'clock ` +
    `${Math.round(mins)} minutes, at a radius of ` +
    `${solution.radiusArcmin.toFixed(1)} arcminutes from the centre.`;

  const sc = $('sky');
  drawSkyChart(sc.getContext('2d'), {
    stars,
    lst: lstHours(julianDay(now), site.lon),
    radiusDeg: 50, limitMag: 5.2, night, size: sc.width,
  });

  $('starhopText').textContent =
    `Polaris sits ${latAbs.toFixed(0)}° above the horizon, due true north. ` +
    'The two stars at the front of the Big Dipper’s bowl point at it: ' +
    'follow that line about five times the gap between them.';

  updateGuide();
}

// --- compass ----------------------------------------------------------------
//
// Android reports absolute orientation through `deviceorientationabsolute`.
// Whether the platform has ALREADY corrected to true north is genuinely
// inconsistent between devices, so we apply declination ourselves and let the
// reading be checked against the sky. Verify on real hardware before trusting
// it to a degree -- the chart and the reticle do not depend on this at all.

$('compassBtn').onclick = async () => {
  if (compassOn) return;
  const need = window.DeviceOrientationEvent
    && typeof DeviceOrientationEvent.requestPermission === 'function';
  if (need) {
    try {
      const ok = await DeviceOrientationEvent.requestPermission();
      if (ok !== 'granted') { $('guideText').textContent =
        'Compass permission was declined. The chart below still works.'; return; }
    } catch { /* fall through to the listener attempt */ }
  }
  const evName = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evName, onOrientation);
  compassOn = true;
  $('compassBtn').textContent = 'Compass is on';
  $('compassBtn').classList.remove('primary');
};

function onOrientation(e) {
  if (e.alpha == null) return;
  const magnetic = e.webkitCompassHeading != null
    ? e.webkitCompassHeading                    // already true north on iOS
    : (360 - e.alpha) % 360;
  heading = e.webkitCompassHeading != null || !site
    ? magnetic
    : (magnetic + (solution?.declination ?? 0) + 360) % 360;
  updateGuide();
}

function updateGuide() {
  if (!solution) return;
  const box = $('guideBox'), arrow = $('guideArrow'), text = $('guideText');
  if (heading == null) {
    text.textContent = compassOn
      ? 'Waiting for the compass…'
      : 'Turn on the compass for live directions, or use the chart below.';
    arrow.textContent = '•';
    box.classList.remove('on-target');
    return;
  }
  const target = solution.polarisAz;
  let d = ((target - heading + 540) % 360) - 180;      // signed, −180..180
  const onTarget = Math.abs(d) <= 5;

  if (onTarget) {
    arrow.textContent = '▲';
    text.textContent =
      `Facing Polaris. Now look ${Math.abs(solution.polarisAlt).toFixed(0)}° up.`;
  } else {
    arrow.textContent = d > 0 ? '▶' : '◀';
    text.textContent =
      `Turn ${d > 0 ? 'right' : 'left'} ${Math.abs(d).toFixed(0)}°, ` +
      `then look ${Math.abs(solution.polarisAlt).toFixed(0)}° up.`;
  }
  box.classList.toggle('on-target', onTarget);

  if (onTarget && !lastOnTarget && navigator.vibrate) navigator.vibrate(120);
  lastOnTarget = onTarget;
}

// --- speech -----------------------------------------------------------------

$('speakBtn').onclick = () => {
  if (!solution || !window.speechSynthesis) return;
  const dec = solution.declination;
  const say =
    `Set the latitude to ${Math.abs(solution.latitudeSetting).toFixed(1)} degrees. ` +
    `Point the mount at ${solution.trueNorthOnCompass.toFixed(0)} degrees on your compass, ` +
    `which is ${Math.abs(dec).toFixed(0)} degrees ${dec >= 0 ? 'east' : 'west'} declination. ` +
    `Put Polaris at ${solution.dialHour} o'clock ` +
    `${Math.round(solution.dialMinute)} minutes on the dial, ` +
    `at radius ${solution.radiusArcmin.toFixed(0)} arc minutes.`;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(say);
  u.rate = 0.92;
  speechSynthesis.speak(u);
};

// --- boot -------------------------------------------------------------------

async function boot() {
  applyAppearance();
  try {
    stars = await (await fetch('src/data/stars.json')).json();
  } catch {
    $('starhopText').textContent =
      'Star chart data could not be loaded, but the numbers above still work.';
  }
  const v = modelValidity();
  $('buildLine').textContent =
    `v0.0.0.1.0 · WMM${v.epoch} magnetic model, valid to ${v.validUntil} · ` +
    `${stars.length} stars`;

  if (site) setSite(site, 'Using your last saved position.');
  setInterval(render, 30000);        // Polaris moves ~0.125 dial-minutes in 30 s

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
