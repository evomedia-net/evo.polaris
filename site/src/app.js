// evo.polaris -- app wiring.

import { alignmentSolution, julianDay, lstHours, solarNoon, sunNow } from './astro.js';
import { declination, modelValidity } from './geomag.js';
import { drawSkyChart, drawReticle } from './chart.js';
import { spellAngle } from './words.js';
import { resolveCoordinate, hemisphereFor, validate } from './coords.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('polaris.' + k)) ?? d; }
              catch { return d; } },
  set(k, v) { try { localStorage.setItem('polaris.' + k, JSON.stringify(v)); }
              catch { /* private mode: preferences just don't persist */ } },
};

// Where the hand-entry fields start from when there is nothing saved yet.
// ZIP 77339, Humble / Kingwood TX -- coordinates from zippopotam.us, elevation
// from the same Open-Meteo lookup the button uses.
//
// It is PREFILLED, never auto-applied. Filling the boxes costs a returning user
// nothing and saves them typing; silently adopting it would hand a first-time
// user in Sydney a Texas solution that is confidently wrong in every number,
// and this app has no business guessing where anyone is standing.
const DEFAULT_SITE = { lat: 30.0563, lon: -95.2107, altitude: 26 };

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

  // The button names the theme you are currently IN, not the one you would
  // switch to. Both are dark; only one is dark-adaptation safe, so they need
  // different names -- "Night Mode" in both states told you nothing.
  //
  // No aria-pressed: a toggle whose label changes AND carries a pressed state
  // reads as a double negative ("Dark Mode, not pressed"). The accessible name
  // spells out the state and the action instead, which is unambiguous either
  // way round.
  const btn = $('nightToggle');
  btn.textContent = night ? 'Night Mode' : 'Dark Mode';
  btn.setAttribute('aria-label', night
    ? 'Night Mode is on: pure red on black, which preserves dark adaptation. '
      + 'Activate to switch to Dark Mode.'
    : 'Dark Mode is on. Activate to switch to Night Mode, which is pure red on '
      + 'black and preserves dark adaptation.');
  btn.classList.toggle('is-night', night);
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
      // Keep the pickers truthful even when the position came from GPS, so
      // opening the panel afterwards shows the right side of the equator.
      latHemi = hemisphereFor(latitude, 'N', 'S');
      lonHemi = hemisphereFor(longitude, 'E', 'W');
      paintHemi();
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

// --- hemisphere pickers ------------------------------------------------------
//
// The sign of a coordinate is now a button, not a character someone has to
// remember to type. A dropped minus was the worst input bug this app had:
// 33.8688 for Sydney instead of -33.8688 produced a complete, confident,
// northern answer with nothing on screen marking it wrong.

let latHemi = 'N';
let lonHemi = 'W';

function paintHemi() {
  $('latN').setAttribute('aria-pressed', String(latHemi === 'N'));
  $('latS').setAttribute('aria-pressed', String(latHemi === 'S'));
  $('lonE').setAttribute('aria-pressed', String(lonHemi === 'E'));
  $('lonW').setAttribute('aria-pressed', String(lonHemi === 'W'));
}

/** Show a signed value as a magnitude, with the button carrying the sign. */
function fillCoord(inputId, value, positive, negative) {
  $(inputId).value = Math.abs(value).toFixed(4);
  return hemisphereFor(value, positive, negative);
}

for (const [id, set] of [['latN', 'N'], ['latS', 'S']]) {
  $(id).onclick = () => { latHemi = set; paintHemi(); };
}
for (const [id, set] of [['lonE', 'E'], ['lonW', 'W']]) {
  $(id).onclick = () => { lonHemi = set; paintHemi(); };
}

// Typing a minus sign still works and moves the button to match, rather than
// being silently overridden by it. The field then normalises to a magnitude so
// the number and the button can never sit on screen contradicting each other.
$('inLat').addEventListener('change', () => {
  const r = resolveCoordinate($('inLat').value, latHemi, 'S');
  if (!r.ok) return;
  latHemi = r.hemi;
  $('inLat').value = r.magnitude;
  paintHemi();
});
$('inLon').addEventListener('change', () => {
  const r = resolveCoordinate($('inLon').value, lonHemi, 'W');
  if (!r.ok) return;
  lonHemi = r.hemi;
  $('inLon').value = r.magnitude;
  paintHemi();
});

$('manualToggle').onclick = () => {
  const box = $('manualEntry');
  box.hidden = !box.hidden;
  if (box.hidden) return;
  // Your saved position if you have one, the default if you do not, so the
  // boxes are never blank and applying them is a tap rather than typing.
  const from = site || DEFAULT_SITE;
  latHemi = fillCoord('inLat', from.lat, 'N', 'S');
  lonHemi = fillCoord('inLon', from.lon, 'E', 'W');
  paintHemi();
  $('inAlt').value = Math.round(from.altitude || 0);
  $('prefillNote').textContent = site
    ? 'Filled in with your saved position.'
    : 'Filled in with a starting point — replace it with yours, or use the '
      + 'location button above.';
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
  const latR = resolveCoordinate($('inLat').value, latHemi, 'S');
  const lonR = resolveCoordinate($('inLon').value, lonHemi, 'W');
  const alt = parseFloat($('inAlt').value);

  if (!latR.ok || !validate(latR.value, 90)) {
    $('locateStatus').textContent =
      'Latitude must be a number from 0 to 90. Use the North / South buttons '
      + 'for the side of the equator.';
    return;                                    // fields keep their values
  }
  if (!lonR.ok || !validate(lonR.value, 180)) {
    $('locateStatus').textContent =
      'Longitude must be a number from 0 to 180. Use the East / West buttons '
      + 'for the side of the prime meridian.';
    return;
  }
  // Keep the form showing exactly what was accepted.
  latHemi = latR.hemi; lonHemi = lonR.hemi;
  $('inLat').value = latR.magnitude;
  $('inLon').value = lonR.magnitude;
  paintHemi();

  setSite({ lat: latR.value, lon: lonR.value,
            altitude: Number.isFinite(alt) ? alt : 0 },
    `Using the position you typed — ${latR.magnitude}° ${latR.hemi}, `
    + `${lonR.magnitude}° ${lonR.hemi}.`);
};

// --- the numbers ------------------------------------------------------------

function hemisphereNote() {
  return site && site.lat < 0
    ? 'Use the polar scope’s 60′–70′ circles — the southern group.'
    : '';
}

function render() {
  if (!site) return;
  const now = new Date();
  const dec = declination(site.lat, site.lon, (site.altitude || 0) / 1000, now);
  solution = alignmentSolution(now, site, dec);

  const latAbs = Math.abs(solution.latitudeSetting);
  $('outLatKnob').textContent = `${latAbs.toFixed(2)}°`;
  // Spelled out underneath. This is the one number that, set wrong, quietly
  // ruins every exposure of the night, and 42 vs 24 is one glance apart.
  $('outLatWords').textContent =
    spellAngle(solution.settings.altitudeAxis)
      .replace(/ (north|south)$/, '');

  const compass = solution.trueNorthOnCompass;
  const poleName = solution.poleName;                 // "true north" | "true south"
  const isSouth = solution.hemisphere === 'south';

  // Headings and static copy that name a hemisphere. Left hardcoded these read
  // confidently wrong in the south -- "Find Polaris in the sky" above a chart
  // of the SOUTH pole, where Polaris is permanently below the horizon.
  $('poleWord2').textContent = poleName;
  $('poleWord4').textContent = isSouth ? 'the south pole' : 'Polaris';
  $('dialLabel').textContent =
    `Put ${solution.star.short} here in the polar scope`;
  $('northIntro').innerHTML = isSouth
    ? 'Your mount points at <strong>true</strong> south, not magnetic south. '
      + 'Any one of these gets you there — and the first two need no instrument '
      + 'at all.'
    : 'Your mount points at <strong>true</strong> north, not magnetic north. '
      + 'Any one of these gets you there — and the first two need no instrument '
      + 'at all.';
  $('poleStarClaim').innerHTML = isSouth
    ? 'The Southern Cross points the way'
    : 'Polaris <em>is</em> true north';
  $('skyDesc').textContent = isSouth
    ? 'The sky around the south pole right now. The amber arrow runs the long '
      + 'axis of the Southern Cross out to the pole; the dotted line from the '
      + 'Pointers crosses it there, confirming the spot.'
    : 'The sky around the pole right now. Follow the two front stars of the '
      + 'Big Dipper’s bowl — the amber arrow — straight to Polaris.';
  $('outCompass').textContent =
    `${poleName[0].toUpperCase()}${poleName.slice(1)} reads ${compass.toFixed(1)}°`;

  // --- finding true north without a compass --------------------------------
  // Polaris is within about half a degree of the pole, so pointing at it IS
  // pointing true north. Worth saying plainly: people assume they need north
  // first in order to find Polaris, when it works the other way round.
  // The southern sky has no usable pole star, and pretending otherwise sends
  // someone hunting a magnitude 5.5 speck. Say what actually works instead.
  $('outNorthStar').textContent = solution.hemisphere === 'south'
    ? 'There is no southern Polaris. Sigma Octantis (Polaris Australis) sits '
      + `${solution.radiusArcmin.toFixed(0)}′ from the pole but is only magnitude 5.5 — `
      + 'below naked-eye visibility except under dark skies, and hard work even in '
      + 'a polar scope. Use the sky instead: run the long axis of the Southern '
      + 'Cross about 4.5 times its own length. The chart in step 4 draws it.'
    : `Polaris is only ${solution.radiusArcmin.toFixed(0)}′ `
      + `(${(solution.radiusArcmin / 60).toFixed(2)}°) from the true pole, so aiming `
      + 'at it is aiming true north. Use the chart in step 4 to find it — '
      + 'no compass, no declination, nothing to correct.';

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

  // --- everything to physically set, in the units the mount asks for -------
  const set = solution.settings;
  $('setAlt').textContent = `${set.altitudeAxis.text} (${set.altitudeAxisDeg.toFixed(2)}°)`;
  $('setAz').textContent = `${set.azimuthTrue}° — ${poleName}`;
  $('setAzMag').textContent = `${set.azimuthOnCompass.toFixed(1)}°`;
  $('setLat').textContent = set.latitude.text;
  $('setLon').textContent = set.longitude.text;
  $('setElev').textContent = `${set.elevationM} m`;
  $('setUtc').textContent = set.utcOffset.text;
  $('setLst').textContent = set.localSiderealTime.text;
  $('settingsNote').textContent =
    'Degrees and minutes, because that is what hand controllers and setting '
    + 'circles ask for. Sidereal time is what an RA setting circle is zeroed '
    + 'against — it is not clock time and drifts about 4 minutes a day.';

  // --- the order to do it in -----------------------------------------------
  // Levelling comes first and is the step most often skipped. On an unlevel
  // tripod the altitude and azimuth adjustments stop being independent: moving
  // one drags the other, and you chase the pole around without converging.
  const roughStep = isSouth
    ? 'Rough-point the mount at the south pole — run the long axis of the '
      + 'Southern Cross out about 4.5 times its length — and get that patch of '
      + 'sky into the polar scope.'
    : 'Rough-point the mount at Polaris. The two front stars of the Big '
      + 'Dipper’s bowl, Merak and Dubhe, point straight at it. Get it into the '
      + 'polar scope’s field of view.';
  const steps = [
    ['Level the tripod.', 'Everything after this assumes it. On an unlevel '
      + 'tripod the altitude and azimuth adjustments stop being independent — '
      + 'moving one drags the other and you never quite converge.'],
    [`Set the altitude axis to ${set.altitudeAxis.text}.`,
      'The bolt and scale at the back of the base.'],
    [`Swing the azimuth to ${set.azimuthTrue}° (${poleName}).`,
      `On a magnetic compass here that reads ${set.azimuthOnCompass.toFixed(0)}°.`],
    [roughStep, ''],
    ['Loosen the azimuth and altitude locks a little.',
      'Just enough that the mount moves smoothly under the fine knobs.'],
    [`Bring ${solution.star.short} to ${solution.dialHour}:`
      + `${String(Math.round(solution.dialMinute)).padStart(2, '0')} `
      + `at ${solution.radiusArcmin.toFixed(1)}′.`,
      'Use the fine altitude and azimuth knobs only — not the tripod.'],
    ['Lock everything down gently, then look again.',
      'Tightening can nudge the mount off. Re-check before you trust it.'],
  ];
  const ol = $('procedure');
  ol.replaceChildren(...steps.map(([head, detail]) => {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = head;
    li.append(b);
    if (detail) li.append(' ', detail);
    return li;
  }));

  $('timeNote').textContent =
    `Good for ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. ` +
    'Polaris moves about one dial minute every two minutes — reset it if you take a break.';

  const rc = $('reticle');
  drawReticle(rc.getContext('2d'), {
    dialDecimal: solution.dialDecimal,
    radiusArcmin: solution.radiusArcmin,
    rings: solution.star.rings,          // 36'-44' north, 60'-70' south
    size: rc.width, night,
  });
  $('reticleDesc').textContent =
    `Polar scope reticle. ${solution.star.short} goes at ${solution.dialHour} o'clock ` +
    `${Math.round(mins)} minutes, at a radius of ` +
    `${solution.radiusArcmin.toFixed(1)} arcminutes from the centre.`;

  const sc = $('sky');
  drawSkyChart(sc.getContext('2d'), {
    stars,
    lst: lstHours(julianDay(now), site.lon),
    radiusDeg: 50, night, size: sc.width,
    south: solution.hemisphere === 'south',
  });

  $('starhopText').textContent = solution.hemisphere === 'south'
    ? `The south celestial pole sits ${latAbs.toFixed(0)}° above the horizon, due `
      + 'true south. Run the long axis of the Southern Cross — Gacrux at the top '
      + 'through Acrux at the foot — onward about 4.5 times its own length. To '
      + 'confirm it, take the two bright Pointers (Alpha and Beta Centauri), and '
      + 'follow a line at right angles from the middle of the gap between them: '
      + 'where the two lines meet is the pole. The Pointers also tell you it is '
      + 'the real Cross — the False Cross has no pair beside it.'
    : `Polaris sits ${latAbs.toFixed(0)}° above the horizon, due true north. `
      + 'The two stars at the front of the Big Dipper’s bowl point at it: '
      + 'follow that line about five times the gap between them.';

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
    `Set the altitude axis to ${spellAngle(solution.settings.altitudeAxis)}. ` +
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
