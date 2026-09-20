// evo.polaris -- app wiring.

import {
  alignmentSolution, julianDay, lstHours, solarNoon, sunNow,
  equatorialToHorizontal,
} from './astro.js';
import { declination, modelValidity } from './geomag.js';
import { drawSkyChart, drawReticle } from './chart.js';
import { spellAngle } from './words.js';
import { pointingGuidance, guidanceArrow, guidanceText } from './guide.js';
import { buildSkyVectors, smoothAngle, buildMilkyWay } from './skyview.js';
// Site chrome, not app: mounts only on evomedia.net and no-ops anywhere else.
// Delete this import and evomedia-chrome.js to strip the branding entirely.
import { mountEvomediaChrome } from './evomedia-chrome.js';
import { fetchIss, lookAngles, describePass } from './iss.js';
import { drawSkyView, drawMoonDisc } from './skydraw.js';
import { moonPhase, describeMoon } from './moon.js';
import { spokenBriefing } from './briefing.js';
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
let tilt = null;             // DeviceOrientation beta, or null if unreported
let roll = null;             // gamma
let rawAlpha = null;         // alpha as reported, for the sky view's own basis
let skyVectors = null;       // star directions, recomputed on a slow timer
let skyOn = false;
let skyFov = 65;
// Following the phone is the DEFAULT, because that is what anyone expects of a
// sky view and it is the thing that makes it feel like a window rather than a
// picture. It falls back to manual on its own when the device reports no
// orientation -- every desktop, and any phone that declines the permission --
// and any press on the pad takes control back. The accessible layout, for
// people who cannot sweep a phone around, layers on top of that rather than
// replacing it.
let skyFollow = true;
let skyAim = { az: 0, alt: 45 };
// Both on by default: the figures are how people recognise what they are
// looking at, and the band is what most of them are pointing a camera at.
let skyConstellations = true;
let skyMilkyWay = true;
let milkyWay = null;
let issMark = null;          // {alt, az, sunlit} once asked for, else null
// Smoothed copies. Raw orientation readings jitter by a degree or two even on
// a still phone, and at a 65 degree field that is several pixels of shake on
// every star -- enough to make the view look broken rather than alive.
let sAlpha = null, sBeta = null, sGamma = null;
let skyFrame = null;                 // pending requestAnimationFrame
let sawSensor = false;
let sensorInfo = { event: null, absolute: null, screen: 0 };
let lastOnTarget = false;

// --- which of the two jobs is on screen -------------------------------------
//
// This app does two things now. Aligning a mount is a numbered procedure done
// once, at the start of a night. Looking at the sky is not a procedure at all
// and happens all evening. They used to be one long scroll with the sky view
// four cards down, which is a long way to go to find the Big Dipper.
let mode = store.get('mode', 'sky');

// null means "work it out from whether the phone is steering"; true or false
// is a choice someone made, and a choice outranks the guess.
let padOpen = store.get('padOpen', null);

// Whether the compass is on because someone asked for it on the Align side,
// as opposed to the sky view switching it on to follow the phone. It decides
// who is allowed to switch it off again.
let compassByUser = false;

// --- appearance -------------------------------------------------------------

let scale = store.get('scale', 1);
let night = store.get('night', false);

function applyAppearance() {
  document.documentElement.style.setProperty('--scale', scale);
  document.documentElement.dataset.night = night ? 'on' : 'off';

  // THE LABEL IS THE ACTION, as on every other button here -- it names the
  // theme you would switch TO, never the one you are in. It used to name the
  // current state, which made it the exact opposite of the compass button one
  // card below, and a state label only works if you can also SEE which state
  // you are in. Read aloud, "button, Dark Mode" says nothing about what
  // happens next; at 1.8x text in the dark, the highlight carrying that state
  // may be the part you cannot make out.
  //
  // Both themes are dark and only one is dark-adaptation safe, so both still
  // need naming -- "Use Night Mode" does that and says which way it goes.
  //
  // No aria-pressed: a toggle whose label changes AND carries a pressed state
  // reads as a double negative ("Use Night Mode, not pressed").
  const btn = $('nightToggle');
  btn.textContent = night ? 'Use Dark Mode' : 'Use Night Mode';
  btn.setAttribute('aria-label', night
    ? 'Switch to Dark Mode. Night Mode is on now: pure red on black, which '
      + 'preserves dark adaptation.'
    : 'Switch to Night Mode, which is pure red on black and preserves dark '
      + 'adaptation. Dark Mode is on now.');
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

/** The one-line summary that replaces the card once the question is answered. */
function placeSummary() {
  // Latitude and longitude only. Altitude is in the card -- it earns its place
  // there and not here, because it moves the magnetic declination by under
  // 0.01 degrees even at 3000 m, and spelling it out on this line pushed the
  // button onto a second row.
  const la = `${Math.abs(site.lat).toFixed(2)}° ${site.lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(site.lon).toFixed(2)}° ${site.lon >= 0 ? 'E' : 'W'}`;
  return `${la}, ${lo}`;
}

function setSite(next, note) {
  site = next;
  store.set('site', site);
  $('siteReadout').hidden = false;
  $('outLat').textContent = `${site.lat.toFixed(4)}° ${site.lat >= 0 ? 'N' : 'S'}`;
  $('outLon').textContent = `${site.lon.toFixed(4)}° ${site.lon >= 0 ? 'E' : 'W'}`;
  $('outAlt').textContent = Number.isFinite(site.altitude)
    ? `${Math.round(site.altitude)} m` : 'not supplied';
  $('locateStatus').textContent = note;

  // Position is a prerequisite for BOTH jobs, so it lives above the picker
  // rather than inside one of them -- and answering it collapses the card to a
  // single line and hands the screen back to the work.
  $('placeWhere').textContent = placeSummary();
  $('placeBar').hidden = false;
  $('placeCard').hidden = true;
  setPlaceChangeLabel(false);
  $('modePicker').hidden = false;

  render();                 // solution first: the sky view cannot draw without it
  applyMode();
}

/**
 * The visible word is short because it shares a single row with the
 * coordinates on a phone, and "Change where I am" pushed it onto a second row.
 * The accessible name carries the whole phrase, so what a screen reader
 * announces is the full label and not the abbreviation.
 */
function setPlaceChangeLabel(open) {
  const btn = $('placeChange');
  btn.textContent = open ? 'Hide' : 'Change';
  btn.setAttribute('aria-label',
    open ? 'Hide the position boxes' : 'Change where I am');
}

$('placeChange').onclick = () => {
  const opening = $('placeCard').hidden;
  $('placeCard').hidden = !opening;
  setPlaceChangeLabel(opening);
};

// --- the two modes -----------------------------------------------------------

function applyMode() {
  const sky = mode === 'sky';
  $('modeSkyBtn').setAttribute('aria-selected', String(sky));
  $('modeAlignBtn').setAttribute('aria-selected', String(!sky));
  $('modeSkyBtn').tabIndex = sky ? 0 : -1;
  $('modeAlignBtn').tabIndex = sky ? -1 : 0;
  $('paneSky').hidden = !sky;
  $('paneAlign').hidden = sky;

  skyOn = sky;
  if (sky) {
    refreshSkyVectors();
    aimAtPole();
    // Following needs the orientation listener, so asking for it is part of
    // opening the view rather than a second thing to discover.
    if (skyFollow && !compassOn) startCompass();
    updateSkyMode();
    drawLiveSky();
  } else if (compassOn && !compassByUser) {
    // The sky view turned it on and the sky view has gone; a sensor nobody is
    // reading is just battery. Leaving the pane is not a change of preference,
    // though, so the follow setting survives being stopped.
    const wanted = skyFollow;
    stopCompass();
    skyFollow = wanted;
  }
}

function setMode(next) {
  if (mode !== next) {
    mode = next;
    store.set('mode', mode);
    applyMode();
  }
  $(mode === 'sky' ? 'modeSkyBtn' : 'modeAlignBtn').focus();
}

$('modeSkyBtn').onclick = () => setMode('sky');
$('modeAlignBtn').onclick = () => setMode('align');

// Left/right between the two tabs, which is what a tablist is expected to do.
// Scoped to the picker so it cannot collide with the arrow keys that pan the
// sky view.
$('modePicker').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setMode(mode === 'sky' ? 'align' : 'sky');
});

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
  // It opens and closes, so the label has to move with it. It did not, which
  // left a button reading "Enter it by hand instead" sitting directly above
  // the boxes it had already opened.
  $('manualToggle').textContent = box.hidden
    ? 'Enter it by hand instead' : 'Hide the hand-entry boxes';
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
      + 'Cross about 4.5 times its own length. The chart in step 3 draws it.'
    : `Polaris is only ${solution.radiusArcmin.toFixed(0)}′ `
      + `(${(solution.radiusArcmin / 60).toFixed(2)}°) from the true pole, so aiming `
      + 'at it is aiming true north. Use the chart in step 3 to find it — '
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

  // The exact words the button will say, printed. One source, so the audio and
  // the text can never drift apart -- and for a deaf or hard-of-hearing user
  // this IS the sentence, since the button alone would give them nothing.
  $('spokenText').textContent = spokenBriefing(solution);

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

  // --- the Moon, the brightest thing that will ruin an exposure --------------
  const moon = moonPhase(now);
  const moonHz = equatorialToHorizontal(moon.ra, moon.dec, solution.lst, site.lat);
  $('moonText').textContent =
    `${describeMoon(moon, moonHz.alt)} Bearing ${moonHz.az.toFixed(0)}°, `
    + `${Math.round(moon.distanceKm).toLocaleString()} km away.`;
  const md = $('moonDisc');
  drawMoonDisc(md.getContext('2d'), {
    illuminated: moon.illuminated, waxing: moon.waxing, size: md.width, night,
  });

  updateGuide();
}

// --- compass ----------------------------------------------------------------
//
// Android reports absolute orientation through `deviceorientationabsolute`.
// Whether the platform has ALREADY corrected to true north is genuinely
// inconsistent between devices, so we apply declination ourselves and let the
// reading be checked against the sky. Verify on real hardware before trusting
// it to a degree -- the chart and the reticle do not depend on this at all.

let orientEvent = null;      // the event name we actually subscribed to

function stopCompass() {
  if (orientEvent) window.removeEventListener(orientEvent, onOrientation);
  orientEvent = null;
  compassOn = false;
  // Drop the readings too. Leaving the last ones behind would keep the arrows
  // pointing confidently at a heading nobody is measuring any more, which is
  // worse than admitting there is no compass.
  heading = null; tilt = null; roll = null; rawAlpha = null;
  sAlpha = sBeta = sGamma = null;
  sawSensor = false;
  skyFollow = false;                        // fall back to the pad
  $('compassBtn').textContent = 'Turn on the compass';
  $('compassBtn').classList.add('primary');
  $('skyDiag').textContent = '';
  updateGuide();
  if (skyOn) { updateSkyMode(); drawLiveSky(); }
}

async function startCompass() {
  const need = window.DeviceOrientationEvent
    && typeof DeviceOrientationEvent.requestPermission === 'function';
  if (need) {
    try {
      const ok = await DeviceOrientationEvent.requestPermission();
      if (ok !== 'granted') {
        $('guideText').textContent =
          'Compass permission was declined. The chart and the buttons still work.';
        return;
      }
    } catch { /* fall through to the listener attempt */ }
  }
  orientEvent = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(orientEvent, onOrientation);
  sensorInfo.event = orientEvent;
  compassOn = true;
  $('compassBtn').textContent = 'Turn off the compass';
  $('compassBtn').classList.remove('primary');
}

// A toggle, not a one-way switch. It was the latter, so once the compass was
// on there was no way to stop it draining the battery or to fall back to the
// buttons when the reading was obviously wrong.
$('compassBtn').onclick = () => {
  // Pressing THIS button is a standing request: it survives switching panes,
  // and only this button can withdraw it. The sky view's own follow toggle
  // borrows the compass and is not allowed to stop one someone else asked for.
  if (compassOn) { compassByUser = false; stopCompass(); }
  else { compassByUser = true; startCompass(); }
};

function onOrientation(e) {
  // beta is captured even when alpha is missing: a phone can report tilt
  // without a usable compass, and the altitude half is still worth having.
  if (typeof e.beta === 'number' && !Number.isNaN(e.beta)) tilt = e.beta;
  if (typeof e.gamma === 'number' && !Number.isNaN(e.gamma)) roll = e.gamma;
  if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) rawAlpha = e.alpha;

  sAlpha = smoothAngle(sAlpha, rawAlpha ?? 0);
  sBeta = smoothAngle(sBeta, tilt ?? 0);
  sGamma = smoothAngle(sGamma, roll ?? 0);
  if (e.absolute != null) sensorInfo.absolute = e.absolute;
  sensorInfo.screen = screenAngle();

  // The very first reading is what decides whether this device can follow at
  // all, so the label has to be refreshed then -- otherwise the view follows
  // the phone while the text underneath still says to use the buttons.
  if (skyOn && !sawSensor) { sawSensor = true; updateSkyMode(); }

  // One redraw per frame, not one per event. Orientation fires faster than the
  // display refreshes, and projecting three thousand stars for frames nobody
  // ever sees is how a live view turns into a slideshow.
  if (skyOn && skyFollow && skyFrame === null) {
    skyFrame = requestAnimationFrame(() => { skyFrame = null; drawLiveSky(); });
  }
  if (e.alpha == null) { updateGuide(); return; }
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
  const tiltEl = $('guideTilt');

  // Aim at the POLE, not at the pole star. In the north they are within half a
  // degree so it makes no odds; in the south Sigma Octantis is magnitude 5.5
  // and there is nothing to see, so the pole itself is the only honest target.
  const targetName = solution.hemisphere === 'south'
    ? 'the south pole' : 'Polaris';

  const g = pointingGuidance({
    targetAz: solution.poleAzimuth,
    targetAlt: Math.abs(solution.latitudeSetting),
    heading,
    beta: tilt,
  });

  arrow.textContent = guidanceArrow(g);
  text.textContent = guidanceText(g, targetName, Math.abs(solution.latitudeSetting));

  // The live tilt reading, shown whether or not it is on target: it doubles as
  // an inclinometer for the mount's altitude scale, and it is the only way to
  // find out on real hardware whether this phone's beta means what we think.
  if (g.pointingAlt === null) {
    tiltEl.textContent = '';
  } else {
    tiltEl.textContent =
      `Phone is aimed ${g.pointingAlt >= 0 ? '' : 'below the horizon, '}`
      + `${Math.abs(g.pointingAlt).toFixed(0)}° `
      + `${g.pointingAlt >= 0 ? 'above the horizon' : 'down'}`
      + ` · target ${Math.abs(solution.latitudeSetting).toFixed(0)}°`;
  }

  box.classList.toggle('on-target', g.onTarget);
  if (g.onTarget && !lastOnTarget && navigator.vibrate) navigator.vibrate(120);
  lastOnTarget = g.onTarget;
}

// --- speech -----------------------------------------------------------------

$('speakBtn').onclick = () => {
  if (!solution) return;
  const say = spokenBriefing(solution);      // the same string shown on screen
  if (!window.speechSynthesis) {
    // No speech engine. The text is already on screen, so say so rather than
    // letting the button look broken -- but say it BESIDE the button, not in
    // it. Overwriting the label with a sentence left a control that no longer
    // named its own action, which is the thing every label here promises.
    $('speakNote').textContent =
      'This browser has no speech engine. The words are below.';
    $('speakBtn').disabled = true;
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(say);
  u.rate = 0.92;
  speechSynthesis.speak(u);
};

// --- boot -------------------------------------------------------------------

async function boot() {
  mountEvomediaChrome();
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


// --- the live sky view ------------------------------------------------------
//
// An ADDITION, never a replacement. It asks for the one thing the rest of this
// app is built to avoid -- holding a phone up, steadily, and looking at it --
// so it is behind a button, off by default, and everything it shows still
// exists as numbers, as the arrows and as the circumpolar chart.

function refreshSkyVectors() {
  if (!site || !stars.length) return;
  const lst = lstHours(julianDay(new Date()), site.lon);
  skyVectors = buildSkyVectors(stars, lst, site.lat, 5.5);
  // Same slow tick as the stars: the band turns with the sky, not with you.
  milkyWay = buildMilkyWay(lst, site.lat);
}

function drawLiveSky() {
  if (!skyOn || !solution) return;
  if (!skyVectors) refreshSkyVectors();
  if (!skyVectors) return;
  const c = $('liveSky');
  const useDevice = skyFollow && rawAlpha !== null;
  if (useDevice) updateSensorReadout();
  drawSkyView(c.getContext('2d'), {
    aim: useDevice ? null : skyAim,
    screenAngle: sensorInfo.screen,
    sky: skyVectors,
    alpha: sAlpha ?? rawAlpha ?? 0,
    beta: sBeta ?? tilt ?? 90,
    gamma: sGamma ?? roll ?? 0,
    declination: solution.declination,
    targetAlt: Math.abs(solution.latitudeSetting),
    targetAz: solution.poleAzimuth,
    targetName: solution.hemisphere === 'south' ? 'South pole' : 'Polaris',
    w: c.width, h: c.height, fov: skyFov, night,
    constellations: skyConstellations,
    milkyWay: skyMilkyWay ? milkyWay : null,
    iss: issMark,
  });
}

function aimAtPole() {
  if (!solution) return;
  skyAim = { az: solution.poleAzimuth, alt: Math.abs(solution.latitudeSetting) };
}

function updateSkyMode() {
  const following = skyFollow && rawAlpha !== null;
  $('skyMode').textContent = following
    ? 'Following the phone. The buttons take over again if you press one.'
    : `Looking ${Math.round(skyAim.az)}° round and ${Math.round(skyAim.alt)}° up. `
      + 'Use the buttons or the arrow keys — nothing needs to be held up.';
  $('skyFollow').textContent = following
    ? 'Stop following the phone' : 'Follow the phone instead';

  // The pad is five full-width buttons -- most of a phone screen. While the
  // phone itself is steering they do nothing, so they are not on screen. The
  // moment there is no sensor to follow they are the ONLY way to move the view
  // -- every desktop, and any phone that declines the permission -- so they
  // open themselves rather than waiting to be found.
  const padVisible = padOpen === null ? !following : padOpen;
  $('skyPad').hidden = !padVisible;
  $('padToggle').textContent = padVisible
    ? 'Hide the hand controls' : 'Move the view by hand';
  for (const id of ['skyUp', 'skyDown', 'skyLeft', 'skyRight']) {
    $(id).disabled = following;
  }
}

function pan(dAz, dAlt) {
  // Any button press drops out of follow mode: the alternative is fighting the
  // sensor for control, which is worse than either mode alone.
  skyFollow = false;
  skyAim = {
    az: ((skyAim.az + dAz) % 360 + 360) % 360,
    alt: Math.max(-30, Math.min(89, skyAim.alt + dAlt)),
  };
  updateSkyMode();
  drawLiveSky();
}

document.addEventListener('visibilitychange', () => {
  // A hidden tab does not run requestAnimationFrame, so a frame scheduled just
  // before the switch is still pending on the way back and blocks every later
  // one. Drop it and redraw once, rather than trusting it to arrive.
  if (document.hidden) return;
  if (skyFrame !== null) { cancelAnimationFrame(skyFrame); skyFrame = null; }
  if (skyOn) drawLiveSky();
});

function screenAngle() {
  const o = window.screen && window.screen.orientation;
  if (o && typeof o.angle === 'number') return o.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

// What this phone actually reports. Sensor behaviour cannot be tested from a
// desktop, and the failure that matters -- a RELATIVE alpha, whose zero is
// wherever the phone happened to be -- looks exactly like a working view that
// happens to be aimed at the wrong part of the sky. So the app says so.
function updateSensorReadout() {
  const el = $('skyDiag');
  if (!el) return;
  const abs = sensorInfo.absolute;
  const warn = sensorInfo.event === 'deviceorientation' && abs !== true
    ? ' — this phone did not offer an absolute compass, so the sky may be '
      + 'turned the wrong way. Use the buttons instead.'
    : '';
  el.textContent =
    `${sensorInfo.event || 'no'} event · absolute ${abs === null ? 'unstated' : abs}`
    + ` · alpha ${Math.round(sAlpha ?? 0)}° beta ${Math.round(sBeta ?? 0)}°`
    + ` gamma ${Math.round(sGamma ?? 0)}° · screen ${sensorInfo.screen}°${warn}`;
}

const STEP = 15;
$('skyUp').onclick = () => pan(0, STEP);
$('skyDown').onclick = () => pan(0, -STEP);
$('skyLeft').onclick = () => pan(-STEP, 0);
$('skyRight').onclick = () => pan(STEP, 0);
$('skyPole').onclick = () => { skyFollow = false; aimAtPole(); updateSkyMode(); drawLiveSky(); };
$('skyFollow').onclick = () => {
  skyFollow = !skyFollow;
  if (skyFollow) {
    if (!compassOn) startCompass();
  } else if (compassOn && !compassByUser) {
    // In this pane, following IS the compass, so turning it off here has to
    // actually stop the sensor -- otherwise the off switch switches nothing
    // off. It leaves alone a compass the Align side asked for.
    stopCompass();
  }
  updateSkyMode();
  drawLiveSky();
};

$('padToggle').onclick = () => {
  const following = skyFollow && rawAlpha !== null;
  const visible = padOpen === null ? !following : padOpen;
  padOpen = !visible;
  store.set('padOpen', padOpen);
  updateSkyMode();
};

// Arrow keys, one key at a time, no modifiers. Same reasoning as the buttons.
window.addEventListener('keydown', (e) => {
  if (!skyOn || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  // The mode picker is a tablist and owns left/right for itself.
  if (e.target.getAttribute && e.target.getAttribute('role') === 'tab') return;
  const moves = {
    ArrowUp: [0, STEP], ArrowDown: [0, -STEP],
    ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0],
  };
  if (moves[e.key]) { e.preventDefault(); pan(...moves[e.key]); }
});

// The live sky view no longer has its own show/hide button: it IS the
// Tonight's sky pane, and applyMode() opens and closes it. A button whose only
// job was to reveal the thing you had just navigated to was one press of
// ceremony in front of the feature people come for.

// Zoom by button. Pinching is a two-finger gesture and this app uses none.
// The one networked feature, so it is a button rather than something that
// happens on its own -- and it says what it talked to.
$('issBtn').onclick = async () => {
  if (!site) { $('issOut').textContent = 'Set your position first.'; return; }
  $('issOut').textContent = 'Asking where the station is…';
  try {
    const iss = await fetchIss();
    const look = lookAngles(
      { lat: site.lat, lon: site.lon, heightKm: (site.altitude || 0) / 1000 },
      iss);
    // Only mark it on the sky when it is actually up there. Drawing a marker
    // below the horizon would be drawing the inside of the Earth.
    issMark = look.aboveHorizon
      ? { alt: look.alt, az: look.az, sunlit: iss.sunlit } : null;
    $('issOut').textContent = `${describePass(look, iss)} Position read at `
      + `${iss.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}; `
      + 'it moves about 7 km a second, so this goes stale fast.';
    if (skyOn) drawLiveSky();
  } catch (err) {
    issMark = null;
    $('issOut').textContent =
      `Could not reach the station tracker (${err.message}). Everything else `
      + 'in this app works without the network.';
  }
};

$('skyConst').onclick = () => {
  skyConstellations = !skyConstellations;
  $('skyConst').textContent = skyConstellations
    ? 'Hide the constellations' : 'Show the constellations';
  drawLiveSky();
};
$('skyMilky').onclick = () => {
  skyMilkyWay = !skyMilkyWay;
  $('skyMilky').textContent = skyMilkyWay
    ? 'Hide the Milky Way' : 'Show the Milky Way';
  drawLiveSky();
};

// The one crossing between the two panes. Finding the pole is an alignment
// step, but the live view is the best tool for it, so the alignment side can
// send you there rather than making you know it is over the other side.
$('skyJump').onclick = () => {
  setMode('sky');
  // If the phone is steering, aiming would be overwritten on the next frame;
  // the target arrow at the edge of the view is what guides you there instead.
  if (!(skyFollow && rawAlpha !== null)) aimAtPole();
  updateSkyMode();
  drawLiveSky();
};

$('skyWider').onclick = () => { skyFov = Math.min(110, skyFov + 15); drawLiveSky(); };
$('skyNarrower').onclick = () => { skyFov = Math.max(25, skyFov - 15); drawLiveSky(); };

// The sky turns a quarter of a degree a minute, so the expensive half is on a
// slow timer while the projection runs per orientation event.
setInterval(() => { if (skyOn) { refreshSkyVectors(); drawLiveSky(); } }, 20000);
