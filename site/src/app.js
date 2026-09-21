// evo.polaris -- app wiring.

import {
  alignmentSolution, julianDay, lstHours, solarNoon, sunNow,
  equatorialToHorizontal, precessionMatrix,
} from './astro.js';
import { declination, modelValidity } from './geomag.js';
import { drawSkyChart, drawReticle } from './chart.js';
import { spellAngle } from './words.js';
import { pointingGuidance, guidanceArrow, guidanceText, signedTurn } from './guide.js';
import {
  buildSkyVectors, smoothAngle, buildMilkyWay, buildBodies, altAzToVector,
  screenToVector, aimAfterDrag, basisFromAim, focalLength, vectorToAltAz,
} from './skyview.js';
// Site chrome, not app: mounts only on evomedia.net and no-ops anywhere else.
// Delete this import and evomedia-chrome.js to strip the branding entirely.
import { mountEvomediaChrome } from './evomedia-chrome.js';
// How long the app was actually used. One page means the access log cannot
// say; this reports elapsed seconds to our own origin and nothing else, and
// stays silent for anyone sending Do Not Track or Global Privacy Control.
import { startDwellBeacon } from './dwell.js';
import {
  fetchIss, fetchIssTrack, orbitLookAngles, lookAngles, describePass, issLookAt,
} from './iss.js';
import { moonTrack, allPlanetTracks, placeTrack } from './tracks.js';
import { drawSkyView, drawMoonDisc } from './skydraw.js';
import {
  moonPhase, describeMoon, sunEquatorial, brightLimbAngle,
  moonRiseSet, describeMoonTimes,
} from './moon.js';
import { planetPositions, describePlanets, PLANET_NAMES } from './planets.js';
import { spokenBriefing } from './briefing.js';
import { resolveCoordinate, hemisphereFor, validate } from './coords.js';
import { VERSION } from './version.js';

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

// The fleet's docs live at docs.evomedia.net/<project>/ -- the same shape as
// /ablecamera/, /evo-ai/ and the rest.
const DOCS_URL = 'https://docs.evomedia.net/polaris/';

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
// What the Manual Controls card was last told. null means "never set", so the
// first update opens or shuts it once and then leaves it alone.
let lastFollowing = null;
let skyAim = { az: 0, alt: 45 };
// Both on by default: the figures are how people recognise what they are
// looking at, and the band is what most of them are pointing a camera at.
let skyConstellations = true;
let skyMilkyWay = true;
// The planets and the Moon are why half of this pane exists now, so both are
// on. They are also the two things that can hide something you were looking
// for -- the Moon is drawn larger than life -- hence the switches.
let skyShowPlanets = true;
let skyShowMoon = true;
let milkyWay = null;
let skyPlanetList = [];
let skyMoonBody = null;

// Full screen. null means "follow the phone's rotation"; true or false is a
// choice someone made by hand, and a choice outranks the rotation until they
// hand it back. Same three-state shape as the pan pad, for the same reason:
// the automatic rule is right nearly always, and "nearly" is not "always".
let fullLock = null;
let fullOn = false;
// The station, once "Find the ISS" has been answered. issFix is the reading
// the tracker gave; the live position is propagated from issSamples, because a
// fix is out of date about as fast as it arrives.
let issOn = false;
let issFix = null;           // {alt, az, aboveHorizon, sunlit} from the fetch
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

// HOW EACH DASHED PATH LOOKS, IN ONE PLACE.
//
// The key on the map and the paths themselves read from this, so they cannot
// drift apart -- a legend that disagrees with the picture is worse than none.
//
// EACH PATH HAS ITS OWN DASH, NOT ONLY ITS OWN COLOUR. In Night Mode every
// track collapses to a shade of red, which is the entire point of Night Mode,
// so a key that told them apart by hue alone would be useless exactly where
// this app is used -- outdoors, in the dark. It is the WCAG 1.4.1 rule too:
// colour must not be the only thing carrying a difference, which matters just
// as much to a red-green colour-blind user in daylight. The Moon and the
// planets shared a dash before this and were told apart by hue alone.
// LONG AND THIN, NOT SHORT AND FAT. A dash has to read as a piece of a line,
// which means it wants to be several times longer than the stroke is thick.
// These were shorter and heavier and came out as a row of blocks on a phone --
// half of that was the dash not scaling with the canvas (fixed in skydraw),
// and half was simply the proportions. The three lengths stay well apart so
// the key still works with no colour at all.
const TRACK_STYLE = {
  iss:     { colour: '#7fd4ff', nightColour: '#c00000', dash: [20, 10], width: 1.5 },
  planets: { colour: '#ffe9a0', nightColour: '#8b0000', dash: [10, 8], width: 1.3 },
  moon:    { colour: '#e6e6e6', nightColour: '#a00000', dash: [4, 8], width: 1.3 },
};

/**
 * The key shows exactly the paths that are on the map, and nothing else.
 *
 * A key to something that is not there sends someone hunting the sky for a
 * line that was never drawn, so each row appears with its path and goes with
 * it -- and the whole plate disappears when nothing is drawn at all.
 */
function updateLegend() {
  let any = false;
  for (const [id, key, on] of [
    ['legIss', 'iss', !!issSamples],
    ['legPlanets', 'planets', skyShowPlanets],
    ['legMoon', 'moon', skyShowMoon],
  ]) {
    const row = $(id);
    row.hidden = !on;
    if (!on) continue;
    any = true;
    const style = TRACK_STYLE[key];
    const line = row.querySelector('line');
    line.setAttribute('stroke', night ? style.nightColour : style.colour);
    line.setAttribute('stroke-dasharray', style.dash.join(' '));
  }
  $('skyLegend').hidden = !any;
}

// The paths bodies move along, rebuilt on the slow tick with everything else.
let skyTracks = [];
// The station's sampled orbit, kept raw so the path can be re-laid whenever
// the time or the place changes without asking the network again.
let issSamples = null;

// WHAT THE RING AND THE ARROW ARE POINTING AT: 'pole' or 'iss'.
//
// "Find the ISS" moves it to the station and "Find the pole" moves it back,
// which is why the pole button does more than re-aim the view.
let guideTarget = 'pole';

// WHERE THE PLANETS BUTTON IS UP TO.
//
// One button, tapped repeatedly, walking out from the Sun -- Mercury first,
// Pluto last, then nothing, then round again. PLANET_NAMES is already in that
// order, which is why the cycle reads it rather than keeping a second list
// that could disagree with the one the map draws from.
//
// -1 means "not in the cycle": something else owns the ring, so the next tap
// starts at Mercury rather than resuming halfway through.
let planetStep = -1;

/** Put the ring on something, and take the planet cycle off unless asked. */
function setTarget(what, { keepCycle = false } = {}) {
  guideTarget = what;
  if (!keepCycle) planetStep = -1;
  updateTargetName();
  updateSkyMode();
  drawLiveSky();
}

/**
 * The name of whatever is being pointed at, above the map.
 *
 * On screen because when the target is off the edge there is only an arrow --
 * the ring carries the name, and the ring is the thing that is not there.
 * Empty when nothing is targeted, so the line does not sit there announcing
 * "none" as though that were a place.
 */
function updateTargetName() {
  const el = $('fullTargetName');
  if (!el) return;
  const t = solution ? aimTarget(issNow()) : null;
  el.textContent = t ? t.name : '';
  const pole = $('tgtPole');
  if (pole && solution) {
    pole.textContent = solution.hemisphere === 'south' ? 'South pole' : 'Polaris';
  }
  // THE SELECTION IS CARRIED BY aria-pressed, NOT BY THE WORDS. These name
  // the value -- which target -- exactly like the hemisphere pickers name a
  // hemisphere, so the label must not change to say what pressing would do.
  // Without this the state would be visible only as a ring somewhere on the
  // map, which is no use to a screen reader at all.
  const onPlanet = PLANET_NAMES.includes(guideTarget);
  for (const [id, on] of [
    ['tgtPole', guideTarget === 'pole'],
    ['tgtIss', guideTarget === 'iss'],
    ['tgtMoon', guideTarget === 'moon'],
    ['tgtPlanets', onPlanet],
  ]) {
    const b = $(id);
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/**
 * Where the station is NOW, or null if it has not been asked for.
 *
 * Propagated along the fitted orbit rather than reusing the fetched fix: the
 * station moves about a degree of look angle per second during a close pass,
 * so an arrow aimed at where it was thirty seconds ago points at empty sky.
 * Falls back to the raw fix when the orbit samples could not be fetched --
 * stale, but a stale direction beats no direction, and the text says so.
 */
function issNow() {
  if (!issOn) return null;
  if (issSamples && site) {
    const look = issLookAt(
      issSamples,
      { lat: site.lat, lon: site.lon, heightKm: (site.altitude || 0) / 1000 },
      appTime());
    if (look) return { ...look, sunlit: issFix ? issFix.sunlit : null };
  }
  return issFix;
}

// --- when you are looking ---------------------------------------------------
//
// null means right now. Anything else is a night being planned for, and every
// number in the app answers for that instant instead.
//
// IT IS DELIBERATELY NOT PERSISTED. Everything else here is -- position, text
// size, theme, which pane you were on -- but a planned date is the one setting
// whose stale value is dangerous. Open the app in a field at midnight, having
// planned a trip a fortnight ago, and it would hand you a complete, confident
// set of mount numbers for the wrong night with nothing obviously wrong on
// screen. Every load starts at "right now".
let plannedFor = null;

/** The instant the whole app is answering for. */
function appTime() {
  return plannedFor ? new Date(plannedFor) : new Date();
}

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

  // THE DOCS OPEN IN THE THEME YOU ARE ALREADY IN.
  //
  // Night Mode exists to protect dark adaptation, which takes twenty to
  // thirty minutes to build and one bright screen to lose. A docs link that
  // opened a white page would undo the whole point of the theme at the moment
  // someone reached for help -- outdoors, in the dark, mid-setup.
  //
  // The theme travels as a query parameter and the docs site applies it
  // BEFORE first paint, so there is not even one white frame. It is sent in
  // both directions rather than only when dark: switching the app back to
  // day and then opening the docs should not leave them red either.
  $('docsLink').href = `${DOCS_URL}?night=${night ? 'on' : 'off'}`;

  updateLegend();
  pinHeader();
  render();
}

/**
 * Keep the header pinned only while it still leaves room for the app.
 *
 * The bar wraps (see style.css), so raising the text raises its height, and on
 * a short screen -- a phone on a call, where the in-call banner takes a slice
 * off the top -- a pinned bar at large text can hold most of the viewport.
 * Past a third of the screen it is doing more harm than the stickiness is
 * worth, so it scrolls away and gives the page back.
 *
 * This is measured rather than written as a media query because the thing that
 * drives it is the text scale, and that lives here, not in CSS.
 */
function pinHeader() {
  const bar = document.querySelector('.bar');
  if (!bar) return;
  // Measure unpinned, or the measurement is of the state we are deciding.
  bar.classList.remove('unpinned');
  const tall = bar.getBoundingClientRect().height > window.innerHeight / 3;
  bar.classList.toggle('unpinned', tall);
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

// --- collapsible cards ------------------------------------------------------
//
// <details> does the work: no click handler, in the tab order for free, and
// announced as expanded or collapsed without being told to. All this adds is
// remembering the choice -- a card you collapsed should still be collapsed
// next time, which is the whole point of collapsing it.
//
// The map card starts open. Everything else starts shut: the reason for
// collapsing them is that they are walls of text, and a wall of text that
// greets you is the thing being fixed.
const CARDS_OPEN_BY_DEFAULT = new Set(['skyCard']);
// The Manual Controls card is not remembered: which mode you are in decides
// it, and a stored "open" would fight that on the next mode change. Visual
// Settings IS remembered -- it is a drawer of preferences, and a drawer you
// shut should stay shut.
const CARDS_THE_APP_OWNS = new Set(['manualCard']);
for (const card of document.querySelectorAll('details.card')) {
  if (!card.id || CARDS_THE_APP_OWNS.has(card.id)) continue;
  card.open = store.get(`open.${card.id}`, CARDS_OPEN_BY_DEFAULT.has(card.id));
  card.addEventListener('toggle', () => store.set(`open.${card.id}`, card.open));
}

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
  $('whenBar').hidden = false;
  setWhenChangeLabel(false);
  paintWhen();
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
  // Two lines, so the button can say what it does without crowding the
  // coordinates beside it. The accessible name is the same words unbroken.
  btn.innerHTML = open ? 'Hide the<br>boxes' : 'Set your<br>location';
  btn.setAttribute('aria-label',
    open ? 'Hide the position boxes' : 'Set your location');
}

$('placeChange').onclick = () => {
  const opening = $('placeCard').hidden;
  $('placeCard').hidden = !opening;
  setPlaceChangeLabel(opening);
};

// --- planning another night --------------------------------------------------

// The hint the ISS section carries when it can actually answer. Captured
// rather than duplicated, so the page stays the one place it is written.
const ISS_HINT = $('issOut').textContent;

const pad2 = (n) => String(n).padStart(2, '0');

/** A Date as the value a datetime-local input wants, in local time. */
function localInputValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function longWhen(d) {
  return d.toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function setWhenChangeLabel(open) {
  const btn = $('whenChange');
  btn.innerHTML = open ? 'Hide the<br>boxes' : 'Change<br>date';
  btn.setAttribute('aria-label',
    open ? 'Hide the date boxes' : 'Change the date');
}

function paintWhen() {
  const planning = plannedFor !== null;
  $('whenText').textContent = planning ? longWhen(appTime()) : 'Right now';
  // A planned night has to look different from a live one at a glance. These
  // are real mount numbers and they are for a date that is not today.
  $('whenBar').classList.toggle('planning', planning);

  // The station's position can be ASKED FOR and not predicted -- this app does
  // no orbit propagation, and iss.js says so. Answering a question about a
  // future night with today's position would be inventing a pass.
  $('issBtn').disabled = planning;
  $('issOut').textContent = planning
    ? 'Where the station is can only be asked for, not predicted — that needs '
      + 'orbit propagation from a fresh element set, which this app does not do. '
      + 'Switch back to right now to use it.'
    : ISS_HINT;

  const v = modelValidity();
  $('whenWarn').textContent =
    planning && appTime().getFullYear() > Number(v.validUntil)
      ? `Past ${v.validUntil} the magnetic model is an extrapolation, so the `
        + 'compass bearing drifts. True north, the star positions and the dial '
        + 'reading are unaffected — they do not use it.'
      : '';

  if (site) { render(); if (skyOn) { refreshSkyVectors(); drawLiveSky(); } }
}

$('whenChange').onclick = () => {
  const opening = $('whenCard').hidden;
  $('whenCard').hidden = !opening;
  setWhenChangeLabel(opening);
  if (!opening) return;
  $('inWhen').value = localInputValue(plannedFor ? appTime() : eveningToday());
  const tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || 'this device';
  $('whenTzNote').textContent =
    `Read in this device's time zone (${tz}). The app cannot tell that you will `
    + 'be somewhere on a different clock, so for a trip across a time-zone line, '
    + 'enter the time as it would read here.';
};

/** Tonight at nine, because that is when people plan to be out. */
function eveningToday() {
  const d = new Date();
  d.setHours(21, 0, 0, 0);
  return d;
}

$('whenApply').onclick = () => {
  const v = $('inWhen').value;
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(+d)) {
    $('whenWarn').textContent = 'That is not a date and time this app can read.';
    return;
  }
  plannedFor = d.toISOString();
  paintWhen();
};

$('whenNow').onclick = () => {
  plannedFor = null;
  paintWhen();
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
    sizeSkyCanvas();
    // Record the orientation WITHOUT acting on it. Opening the view used to
    // call syncFullScreen(), which read the current orientation and filled the
    // screen if it happened to be landscape -- so every desktop, and any phone
    // loaded already sideways, went full screen on load. Full screen follows a
    // ROTATION, which is a change; the state at load is not one.
    seedOrientation();
    aimAtPole();
    // AUTO MODE IS ON FROM THE MOMENT THE VIEW OPENS. The listener is attached
    // here rather than behind a press, so the sky is already following which
    // way the phone is pointed by the time anyone looks at it.
    //
    // iOS is the exception and cannot be helped from here: it requires a user
    // gesture before it will hand over orientation, so the request is refused
    // on load and the Use Auto Mode button -- which IS a gesture -- is what
    // asks again. Android grants it without asking.
    if (skyFollow && !compassOn) startCompass();
    updateSkyMode();
    drawLiveSky();
    autoLoadIss();
  } else {
    if (fullOn) { fullOn = false; applyFullScreen(); }
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  if (!sky && compassOn && !compassByUser) {
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
  const now = appTime();
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

  $('timeNote').textContent = plannedFor
    ? `These are the numbers for ${longWhen(now)} — not for right now. `
      + `${solution.star.short} moves about one dial minute every two minutes, so `
      + 'read them again when you get there.'
    : `Good for ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. `
      + 'Polaris moves about one dial minute every two minutes — reset it if you '
      + 'take a break.';

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
    precess: precessionMatrix(julianDay(now)),
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
  // Rise and set for the day being shown -- which is the planned date when
  // one is set, not today, because every other number on the page already is.
  $('moonTimes').textContent =
    describeMoonTimes(moonRiseSet(now, site.lat, site.lon));

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

// IOS WILL ONLY ASK IF A FINGER ASKED FIRST.
//
// DeviceOrientationEvent.requestPermission() rejects unless it is called from
// a user gesture. The sky view turns the compass on the moment it opens, which
// is not one -- so on an iPhone the request was thrown away, the listener was
// attached to a sensor nobody had granted, and the view sat on "waiting for
// the phone's compass" for ever. The only way through was to press Use Manual
// Mode and then Use Auto Mode, because THAT press is a gesture. Nothing said
// so, and nobody would guess it.
//
// So when there is no gesture to spend, the ask is held until the next one --
// any tap or key anywhere -- instead of being burnt. The status line says
// that is what it is waiting for, because a permission prompt that appears
// on an unrelated tap is worse than one you were told to expect.
let compassGranted = false;
let compassPending = false;

const compassNeedsAsking = () => !!(window.DeviceOrientationEvent
  && typeof DeviceOrientationEvent.requestPermission === 'function');

function askOnNextGesture() {
  if (compassPending) return;
  compassPending = true;
  updateSkyMode();
  // `click` and `keydown`, not pointerdown: Safari counts a completed tap as
  // the activation, and a touch that turns into a scroll is not one.
  const ask = () => {
    window.removeEventListener('click', ask, true);
    window.removeEventListener('keydown', ask, true);
    compassPending = false;
    startCompass({ gesture: true });
  };
  window.addEventListener('click', ask, true);
  window.addEventListener('keydown', ask, true);
}

async function startCompass({ gesture = false } = {}) {
  if (compassNeedsAsking() && !compassGranted) {
    if (!gesture) { askOnNextGesture(); return; }
    try {
      const ok = await DeviceOrientationEvent.requestPermission();
      if (ok !== 'granted') {
        $('guideText').textContent =
          'Compass permission was declined. The chart and the buttons still work.';
        return;
      }
      compassGranted = true;
    } catch {
      // Refused for want of a gesture after all: wait for a better one rather
      // than attaching a listener to a sensor nobody has granted.
      askOnNextGesture();
      return;
    }
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
  else { compassByUser = true; startCompass({ gesture: true }); }
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
  startDwellBeacon();
  applyAppearance();
  try {
    stars = await (await fetch('src/data/stars.json')).json();
  } catch {
    $('starhopText').textContent =
      'Star chart data could not be loaded, but the numbers above still work.';
  }
  const v = modelValidity();
  $('buildLine').textContent =
    `${VERSION} · WMM${v.epoch} magnetic model, valid to ${v.validUntil} · ` +
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
  const when = appTime();
  const jd = julianDay(when);
  const lst = lstHours(jd, site.lon);
  // Sidereal time is of date; the catalogue, the planets and the galactic
  // frame are J2000. One matrix, computed here once per tick, is what puts
  // them in the same sky. Only the alignment path did this before, which is
  // why Polaris was right on the dial and 22 arcminutes off in the view.
  const precess = precessionMatrix(jd);
  skyVectors = buildSkyVectors(stars, lst, site.lat, 5.5, precess);
  // Same slow tick as the stars: the band turns with the sky, not with you.
  milkyWay = buildMilkyWay(lst, site.lat, 6, 3, 18, precess);

  // The planets and the Moon move against the stars, so they are rebuilt on
  // the same tick rather than cached alongside them. Both go through the same
  // rotation the stars do -- one implementation, so they cannot disagree.
  const ph = moonPhase(when);
  const bodies = buildBodies([
    ...planetPositions(when),
    {
      name: 'Moon', ra: ph.ra, dec: ph.dec,
      illuminated: ph.illuminated,
      brightLimb: brightLimbAngle(ph, sunEquatorial(when)),
      isMoon: true,
      // Its series is already of date. Precessing it with the planets would
      // move it 22 arcminutes the wrong way -- the mirror of the bug.
      frame: 'date',
    },
  ], lst, site.lat, precess);
  skyPlanetList = bodies.filter((b) => !b.isMoon);
  skyMoonBody = bodies.find((b) => b.isMoon) || null;
  $('planetsOut').textContent = describePlanets(skyPlanetList);

  // --- the paths they move along ------------------------------------------
  //
  // A planet is one dot among nine thousand. Its PATH is what says which dot
  // it is, and the tracks follow the same switches the bodies do -- hiding the
  // planets hides their paths, because a labelled line to an invisible dot is
  // worse than neither.
  skyTracks = [];
  if (skyShowPlanets) {
    for (const { name, points } of allPlanetTracks(when)) {
      skyTracks.push({
        points: placeTrack(points, lst, site.lat, precess),
        ...TRACK_STYLE.planets,
        label: name,
      });
    }
  }
  if (skyShowMoon) {
    skyTracks.push({
      points: placeTrack(moonTrack(when), lst, site.lat),   // already of date
      ...TRACK_STYLE.moon,
      label: 'Moon',
    });
  }
  if (issSamples) {
    // Re-laid from the samples rather than re-fetched: the geometry depends on
    // the time and the place, the samples do not.
    skyTracks.push({
      points: orbitLookAngles(issSamples,
        { lat: site.lat, lon: site.lon, heightKm: (site.altitude || 0) / 1000 },
        when).map((p) => ({ v: altAzToVector(p.alt, p.az), up: p.up })),
      ...TRACK_STYLE.iss,
      label: 'ISS',
    });
  }
  updateLegend();
}

/**
 * Match the canvas's pixels to the box it is being drawn into.
 *
 * The backing store was a fixed 720x480 and CSS stretched it to fit, which is
 * soft on a phone and outright distorted the moment full screen changes the
 * aspect ratio -- a circle drawn round the pole would come out an oval, on the
 * one view whose whole promise is that things are where they really are.
 *
 * Device pixel ratio is capped at 2: past that it is four times the projection
 * work per frame for a difference nobody can see.
 */
function sizeSkyCanvas() {
  const c = $('liveSky');
  const box = c.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
  if (c.width === w && c.height === h) return false;
  c.width = w; c.height = h;
  return true;
}

function applyFullScreen() {
  const wrap = $('liveSkyWrap');
  wrap.classList.toggle('full', fullOn);
  // The mode button is not a child of the overlay -- it lives in the flow
  // under the map -- so it needs a hook of its own to lift onto the picture.
  document.documentElement.dataset.skyfull = fullOn ? 'on' : 'off';
  // Outward arrows to fill the screen, a cross to come back -- the corner and
  // the symbols every video player uses.
  $('fullGlyph').textContent = fullOn ? '✕' : '⛶';
  $('fullBtn').setAttribute('aria-label',
    fullOn ? 'Leave full screen' : 'Fill the screen');
  sizeSkyCanvas();
  drawLiveSky();
}

const landscapeMq = window.matchMedia
  ? window.matchMedia('(orientation: landscape)') : null;

/** Landscape fills the screen, portrait does not -- unless someone said otherwise. */
function rotationWants() {
  return !!(landscapeMq && landscapeMq.matches);
}

// Auto full screen is a PHONE gesture -- rotate the device to landscape. A
// desktop is permanently landscape and never rotates, so it must NEVER
// auto-fill; only the button does. A coarse pointer is the "this is a touch
// device" signal.
const canAutoFull = !!(landscapeMq && window.matchMedia
  && window.matchMedia('(pointer: coarse)').matches);

// The orientation the last time we looked. Seeded without acting when the view
// opens, so the FIRST genuine flip is detected while the state at load fills
// nothing.
let lastLandscape = null;
function seedOrientation() { lastLandscape = rotationWants(); }

// FULL SCREEN FOLLOWS A ROTATION, NOT A RESIZE OR THE LOAD STATE.
//
// The previous version treated every `resize` as a fresh instruction: it reset
// fullLock and re-synced against the current orientation. On a desktop that is
// permanently landscape, and on a phone the URL bar showing and hiding fires
// resize constantly -- so the screen filled itself at moments nobody rotated
// anything. Now a resize only re-sizes the canvas; the screen fills or empties
// ONLY when the orientation actually flips, and only on a device that rotates.
function onViewportChanged() {
  if (!skyOn) return;
  const now = rotationWants();
  if (now !== lastLandscape) {          // a genuine rotation, not a resize
    lastLandscape = now;
    if (canAutoFull) {
      // A physical rotation is a strong statement of intent, so it resumes
      // auto mode even after the button was used to pin a state.
      fullLock = null;
      if (now !== fullOn) { fullOn = now; applyFullScreen(); }
    }
  }
  if (sizeSkyCanvas()) drawLiveSky();
}

window.addEventListener('resize', onViewportChanged);
window.addEventListener('orientationchange', onViewportChanged);
// Separate listeners: onViewportChanged returns early when the sky pane is
// off, and the header is on every screen.
window.addEventListener('resize', pinHeader);
window.addEventListener('orientationchange', pinHeader);
if (landscapeMq) {
  // On a phone this can arrive before the resize does.
  if (landscapeMq.addEventListener) {
    landscapeMq.addEventListener('change', onViewportChanged);
  } else if (landscapeMq.addListener) {
    landscapeMq.addListener(onViewportChanged);
  }
}

$('fullBtn').onclick = async () => {
  fullLock = !fullOn;
  fullOn = fullLock;
  applyFullScreen();
  // Real fullscreen as well, where it is allowed: this press IS a gesture, so
  // the request can succeed here even though a rotation's cannot. If it is
  // refused the overlay above is already doing the job, so the failure costs
  // nothing and is not worth reporting.
  try {
    if (fullOn) await $('liveSkyWrap').requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch { /* the overlay stands on its own */ }
};

// Leaving real fullscreen by the browser's own gesture -- the Escape key, or a
// swipe -- has to bring the overlay with it, or the page is left covering the
// screen with no way out that looks like the way in.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && fullOn && fullLock === true) {
    fullLock = false;
    fullOn = false;
    applyFullScreen();
  }
});

function drawLiveSky() {
  if (!skyOn || !solution) return;
  if (!skyVectors) refreshSkyVectors();
  if (!skyVectors) return;
  const c = $('liveSky');
  const useDevice = skyFollow && rawAlpha !== null;
  if (useDevice) updateSensorReadout();
  const issLook = issNow();
  const target = aimTarget(issLook);
  updateTargetName();
  drawSkyView(c.getContext('2d'), {
    aim: useDevice ? null : skyAim,
    screenAngle: sensorInfo.screen,
    sky: skyVectors,
    alpha: sAlpha ?? rawAlpha ?? 0,
    beta: sBeta ?? tilt ?? 90,
    gamma: sGamma ?? roll ?? 0,
    declination: solution.declination,
    targetAlt: target.alt,
    targetAz: target.az,
    targetName: target.name,
    w: c.width, h: c.height, fov: skyFov, night,
    constellations: skyConstellations,
    milkyWay: skyMilkyWay ? milkyWay : null,
    tracks: skyTracks,
    planets: skyShowPlanets ? skyPlanetList : null,
    moon: skyShowMoon ? skyMoonBody : null,
    // The marker is only drawn when the station is actually up there --
    // a dot below the horizon would be drawing the inside of the Earth. The
    // TARGET is not so restricted: see below.
    iss: issLook && issLook.aboveHorizon
      ? { alt: issLook.alt, az: issLook.az, sunlit: issLook.sunlit } : null,
  });
}

/**
 * What the ring and the off-screen arrow are for.
 *
 * THE STATION IS TARGETED WHEREVER IT IS, INCLUDING UNDER YOUR FEET. A
 * negative altitude is a real answer to "which way is it" -- it means turn
 * round and look down -- and withholding it leaves someone turning on the
 * spot hunting for something that is not in the sky at all. The arrow is
 * plain geometry and points down through the ground quite happily; only the
 * MARKER is held back to the visible sky.
 */
/** The pole, which is what this app is for and what it falls back to. */
function poleTarget() {
  return {
    alt: Math.abs(solution.latitudeSetting),
    az: solution.poleAzimuth,
    name: solution.hemisphere === 'south' ? 'South pole' : 'Polaris',
  };
}

function aimTarget(issLook) {
  // NOTHING IS A REAL ANSWER. Cycling past the last planet clears the target,
  // and the ring and the arrow both simply go.
  if (guideTarget === 'none') return null;
  if (guideTarget === 'iss') {
    // Asked for but not answered yet -- fall back rather than aim at nothing.
    return issLook ? { alt: issLook.alt, az: issLook.az, name: 'ISS' } : poleTarget();
  }
  if (guideTarget === 'moon') {
    return skyMoonBody
      ? { alt: skyMoonBody.alt, az: skyMoonBody.az, name: 'Moon' }
      : poleTarget();
  }
  const planet = (skyPlanetList || []).find((b) => b.name === guideTarget);
  if (planet) return { alt: planet.alt, az: planet.az, name: planet.name };
  return poleTarget();
}

function aimAtPole() {
  if (!solution) return;
  // Clamped like every other way of aiming. At the poles the setting is 90,
  // which is past where the arrows are allowed to go -- and an aim the buttons
  // cannot hold is an aim they cannot take back over from.
  skyAim = clampAim(solution.poleAzimuth, Math.abs(solution.latitudeSetting));
}

function updateSkyMode() {
  const following = skyFollow && rawAlpha !== null;
  // A planned night has to say so here too. Pointing a phone at a sky drawn
  // for a different date is the one way this view can mislead, and the whole
  // point of it is that what you see is where things really are.
  const when = plannedFor ? `Showing ${longWhen(appTime())}. ` : '';
  const aimed = `${when}Looking ${Math.round(skyAim.az)}° round and `
    + `${Math.round(skyAim.alt)}° up. Use the arrows or the arrow keys — `
    + 'nothing needs to be held up.';
  // What the ring is on, and the honest version of "it is not in the sky".
  const issLook = issNow();
  if (guideTarget === 'iss' && issLook) {
    const az = Math.round((issLook.az + 360) % 360);
    $('skyTarget').textContent = issLook.aboveHorizon
      ? `Tracking the ISS: ${az}° round, ${Math.round(issLook.alt)}° up.`
      : `Tracking the ISS: ${az}° round and ${Math.round(-issLook.alt)}° BELOW `
        + 'the horizon — it is under the ground from here, and the arrow '
        + 'points down at it. Press "Find the pole" to go back.';
  } else {
    $('skyTarget').textContent = '';
  }
  if (following) {
    $('skyMode').textContent =
      `${when}Auto Mode: following the phone. The arrows take over if you `
      + 'press one.';
  } else if (skyFollow) {
    // Auto is on and the phone has not reported yet -- either the first
    // reading is still coming, or this device has no compass to report with.
    // Either way the arrows are already on screen, so the view is usable
    // while it waits rather than frozen looking broken.
    $('skyMode').textContent =
      compassPending
        ? `${when}Auto Mode is on. Tap anywhere to let this phone share which `
          + 'way it is pointing — it will ask once. The arrows work either way.'
        : `${when}Auto Mode is on, waiting for the phone's compass. If nothing `
          + 'moves, this device is not reporting one — the arrows work meanwhile.';
  } else {
    $('skyMode').textContent = `${when}Manual Mode. ${aimed.slice(when.length)}`;
  }
  // AUTO MODE is the phone steering; MANUAL MODE is the arrows. One control,
  // and its label says which way pressing it goes -- the rule every other
  // button here follows.
  //
  // It replaces two buttons whose names were a genuine trap: "Follow the phone
  // instead" meant the sky view follows where the phone POINTS, and "Follow
  // the phone's rotation" meant full screen follows whether the phone is
  // turned SIDEWAYS. Two unrelated settings, near-identical wording.
  //
  // THE LABEL FOLLOWS THE INTENT, NOT THE ACHIEVED STATE. Auto Mode is on from
  // the moment the view opens, so between load and the phone's first
  // orientation reading `following` is false while `skyFollow` is already
  // true. Labelling from `following` there offered "Use Auto Mode" when Auto
  // was ALREADY the mode, and pressing it would have turned Auto off -- a
  // button pointing the opposite way to the one it named.
  const modeBtn = $('modeBtn');
  // Short on the map where space is tight, the whole phrase under it where
  // there is room. The accessible name is the full phrase either way.
  const fullModeBtn = $('fullMode');
  if (fullModeBtn) {
    fullModeBtn.textContent = skyFollow ? 'Use Manual Mode' : 'Use Auto Mode';
    fullModeBtn.setAttribute('aria-label',
      skyFollow ? 'Use Manual Mode' : 'Use Auto Mode');
  }
  modeBtn.textContent = fullOn
    ? (skyFollow ? 'Use Manual' : 'Use Auto')
    : (skyFollow ? 'Use Manual Mode' : 'Use Auto Mode');
  modeBtn.setAttribute('aria-label',
    skyFollow ? 'Use Manual Mode' : 'Use Auto Mode');

  // In Manual Mode the arrows appear; in Auto Mode the phone is doing it and
  // five full-width buttons would be most of a screen doing nothing. There is
  // no third state and nothing to persist: the mode IS the setting.
  // THE PAD LIVES IN A CARD NOW, so the card's open state carries what the
  // hidden attribute used to. Set only when the MODE CHANGES: updateSkyMode
  // runs on every redraw, and forcing it each time would snap the card shut
  // under anyone who opened it by hand while the phone was steering.
  if (following !== lastFollowing) {
    lastFollowing = following;
    const card = $('manualCard');
    if (card) card.open = !following;
  }
  $('fullPan').hidden = following;
  // THE PAD IS NEVER DISABLED. It used to be greyed out while the phone was
  // steering, and on a dark screen at arm's length greyed reads as gone --
  // "the controls to move the screen are not visible". Worse, it contradicted
  // pan() two functions down, which has always dropped follow mode on a press:
  // disabling the buttons made that hand-off unreachable from the one place
  // anyone would look for it, and left "Stop following the phone", a different
  // button in a different place, as the only way back. A press now means what
  // it says: the buttons take over.
}

// How far the view may be pointed. The pad, a tap and a drag all go through
// setAim, so they reach exactly the same places -- which is not tidiness, it
// is the rule: a drag must never get somewhere the buttons cannot.
const AIM_MIN_ALT = -30, AIM_MAX_ALT = 89;

/** Where the view is allowed to point. Nothing sets the aim without this. */
function clampAim(az, alt) {
  return {
    az: ((az % 360) + 360) % 360,
    alt: Math.max(AIM_MIN_ALT, Math.min(AIM_MAX_ALT, alt)),
  };
}

function setAim(az, alt) {
  // Any hand steering drops out of follow mode: the alternative is fighting
  // the sensor for control, which is worse than either mode alone.
  cancelGlide();                 // a hand on the controls beats an animation
  skyFollow = false;
  skyAim = clampAim(az, alt);
  updateSkyMode();
  drawLiveSky();
}

// --- travelling to a target -------------------------------------------------
//
// THE VIEW TRAVELS TO THE POLE RATHER THAN CUTTING TO IT.
//
// A cut gives you a completely different picture with no clue how it relates
// to the one before, so the sky has to be re-read from scratch -- and the
// whole promise of this view is that things are where they really are, which
// is a claim about how the sky is ARRANGED. Watching the stars slide past
// answers "where was I, relative to that?" for free.
//
// IT IS A JUMP IF THE SYSTEM ASKS FOR ONE. prefers-reduced-motion is not a
// stylistic preference; large moving fields are a nausea and vertigo trigger,
// and a full-screen sky sliding under you is about the largest moving field
// this app can produce. The rest of the app already honours the setting in
// CSS, so honouring it here is not an extra kindness, it is consistency.
const GLIDE_MS = 1125;
// { raf, to } -- the pending frame AND where it was going, because a journey
// that gets interrupted still has to end somewhere sensible.
let glide = null;

const wantsStill = () => !!(window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Stop a journey in flight.
 *
 * `arrive` decides what stopping means. A hand on the controls means abandon
 * it where it is -- the hand is steering now. A hidden tab means finish it:
 * a hidden tab does not run requestAnimationFrame, so the animation simply
 * stalls, and coming back to a view stranded half way between where you were
 * and where you asked to go is the worst of both.
 */
function cancelGlide(arrive = false) {
  if (glide === null) return;
  cancelAnimationFrame(glide.raf);
  const { to } = glide;
  glide = null;
  if (arrive) {
    skyAim = to;
    updateSkyMode();
    drawLiveSky();
  }
}

/**
 * Slide the view round to somewhere, instead of arriving there.
 *
 * Azimuth travels the SHORT way round: from 350 to 10 is twenty degrees
 * clockwise, not three hundred and forty the other way, and getting that
 * wrong sends the whole sky the long way past everything.
 */
function glideTo(az, alt) {
  cancelGlide();
  const to = clampAim(az, alt);
  const from = { ...skyAim };
  const dAz = signedTurn(from.az, to.az);
  const dAlt = to.alt - from.alt;
  skyFollow = false;
  // Already there, asked to hold still, or nobody is looking: no animation to
  // run. A hidden tab gets no animation frames at all, so starting a journey
  // in one only strands the view until it comes back.
  if (wantsStill() || document.hidden
      || (Math.abs(dAz) < 0.5 && Math.abs(dAlt) < 0.5)) {
    skyAim = to;
    updateSkyMode();
    drawLiveSky();
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / GLIDE_MS);
    // Ease out: leaves quickly, settles gently. Constant speed reads as a
    // machine moving the sky; this reads as the sky coming to rest.
    const e = 1 - ((1 - t) ** 3);
    skyAim = clampAim(from.az + dAz * e, from.alt + dAlt * e);
    updateSkyMode();
    drawLiveSky();
    glide = t < 1 ? { raf: requestAnimationFrame(step), to } : null;
  };
  glide = { raf: requestAnimationFrame(step), to };
}

function pan(dAz, dAlt) {
  setAim(skyAim.az + dAz, skyAim.alt + dAlt);
}

// --- touching the map -------------------------------------------------------
//
// TAP TO CENTRE, DRAG TO MOVE -- AND NEITHER IS THE ONLY WAY TO DO ANYTHING.
//
// The pan pad reaches every direction these do, through the same setAim and
// the same limits, so nothing here is a capability that belongs only to people
// who can drag. That is the condition this was added under. The pad is not a
// fallback for the gesture; the gesture is a shortcut for the pad.
//
// A TAP IS A DRAG THAT DID NOT MOVE, which is the only definition that works
// for an unsteady hand: ten pixels of wander still means "tap". Anything
// further is a drag, and a drag that went nowhere useful is still not a tap.
const TAP_SLOP = 10;

// Dragging is full screen only, and that is not an oversight. Windowed, the
// map is part of a scrolling page and a finger dragged across it is how the
// page is scrolled -- taking that over would recreate exactly the "the page
// will not scroll" bug this app already had once. Full screen there is no page
// to scroll, so the gesture is free. A tap is safe in both, and is the one
// that matters for a hand that cannot drag anyway.
let drag = null;

/** True when the buttons are steering -- the same test the pad is shown by. */
function handSteering() {
  return skyOn && !(skyFollow && rawAlpha !== null);
}

/** A pointer event as offsets from the centre of the canvas, in ITS pixels. */
function mapOffset(e) {
  const c = $('liveSky');
  const box = c.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return {
    x: (e.clientX - box.left) * (c.width / box.width) - c.width / 2,
    y: (e.clientY - box.top) * (c.height / box.height) - c.height / 2,
  };
}

/** The view basis the map is currently drawn with, for manual aim. */
function aimBasis() {
  return basisFromAim(skyAim.az, skyAim.alt, 0);
}

$('liveSky').addEventListener('pointerdown', (e) => {
  if (!handSteering()) return;
  const at = mapOffset(e);
  if (!at) return;
  const c = $('liveSky');
  const basis = aimBasis();
  const focal = focalLength(c.width, skyFov);
  drag = {
    id: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    basis, focal,
    // The sky under the finger when it went down. The drag is solved against
    // THIS every time rather than against the previous event: solving each
    // small step separately looks the same but quietly discards the roll once
    // per step, and thirty of those compound into a visible drift.
    grabbed: screenToVector(at.x, at.y, basis, focal),
  };
});

window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!fullOn) return;                       // windowed: leave the page alone
  const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (moved < TAP_SLOP) return;              // still a tap, as far as anyone knows
  const at = mapOffset(e);
  if (!at) return;
  const { az, alt } = aimAfterDrag(drag.grabbed, at.x, at.y, drag.basis, drag.focal);
  setAim(az, alt);
});

window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  const d = drag;
  drag = null;
  // A swipe is not a tap even where dragging is switched off, or scrolling the
  // page windowed would fling the view somewhere on release.
  if (far >= TAP_SLOP || !handSteering()) return;
  const at = mapOffset(e);
  if (!at) return;
  const { az, alt } = vectorToAltAz(
    screenToVector(at.x, at.y, d.basis, d.focal));
  // Same move as the pole button -- centre on something -- so it travels the
  // same way. Dragging does not: a drag must track the finger exactly, and
  // easing it would feel like the sky lagging behind the hand.
  glideTo(az, alt);
});

// The browser takes the pointer away to scroll the page; that is the windowed
// case working as intended, and it must not land as a tap on release.
window.addEventListener('pointercancel', () => { drag = null; });

document.addEventListener('visibilitychange', () => {
  // A hidden tab does not run requestAnimationFrame, so a frame scheduled just
  // before the switch is still pending on the way back and blocks every later
  // one. Drop it and redraw once, rather than trusting it to arrive.
  // Going away mid-journey: land it now rather than leave the view stranded
  // between where it was and where it was asked to go.
  if (document.hidden) { cancelGlide(true); return; }
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
$('skyPole').onclick = () => {
  // The pole button is the way back: it takes the ring and the arrow off the
  // station as well as re-aiming the view.
  guideTarget = 'pole';
  planetStep = -1;
  updateTargetName();
  if (!solution) return;
  glideTo(solution.poleAzimuth, Math.abs(solution.latitudeSetting));
};
$('modeBtn').onclick = () => {
  skyFollow = !skyFollow;
  if (skyFollow) {
    // A press IS the gesture iOS wants, so this one can ask outright.
    if (!compassOn) startCompass({ gesture: true });
  } else if (compassOn && !compassByUser) {
    // In this pane, following IS the compass, so turning it off here has to
    // actually stop the sensor -- otherwise the off switch switches nothing
    // off. It leaves alone a compass the Align side asked for.
    stopCompass();
  }
  updateSkyMode();
  drawLiveSky();
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
// THE STATION IS FETCHED WHEN THE SKY OPENS, NOT ONLY WHEN ASKED.
//
// It used to be behind the button alone, so its path was missing from the map
// and its row missing from the key until someone thought to press it -- and
// nothing on screen said the feature existed. Everything else up there is
// computed on the device; the station is the one thing that cannot be,
// because there is no orbit bundled with the app to propagate.
//
// So this is the app's only unprompted call to anyone else's server. It sends
// timestamps and nothing about the observer -- the look angles are worked out
// here from the position that comes back -- and it fails silently, because a
// dark field with no signal is the condition this app is built for and a
// missing station is not an error worth a sentence.
let issAutoTried = false;

async function loadIss({ announce }) {
  if (!site) return false;
  const observer = {
    lat: site.lat, lon: site.lon, heightKm: (site.altitude || 0) / 1000,
  };
  const iss = await fetchIss();
  const look = lookAngles(observer, iss);
  // The orbit is a second request, and losing it must not lose the position
  // the first one already found -- the marker answers the question, the path
  // is the bonus.
  try {
    issSamples = await fetchIssTrack(fetch, appTime());
  } catch { issSamples = null; }
  issFix = {
    alt: look.alt, az: look.az, aboveHorizon: look.aboveHorizon,
    sunlit: iss.sunlit,
  };
  issOn = true;
  refreshSkyVectors();
  updateLegend();
  if (skyOn) { updateSkyMode(); drawLiveSky(); }
  return { iss, look };
}

/** Quietly, on opening the sky. No banner, and no hijacking the ring. */
async function autoLoadIss() {
  if (issAutoTried || issOn || !site) return;
  issAutoTried = true;
  try { await loadIss({ announce: false }); } catch { /* no signal, no fuss */ }
}

$('issBtn').onclick = async () => {
  if (!site) { $('issOut').textContent = 'Set your position first.'; return; }
  $('issOut').textContent = 'Asking where the station is…';
  try {
    const { iss, look } = await loadIss({ announce: true });
    // Pressing this means "show me where it is", so it takes the ring and the
    // arrow with it. The automatic load deliberately does not -- it is not a
    // request to go and look. "Find the pole" is the way back.
    guideTarget = 'iss';
    planetStep = -1;
    updateTargetName();
    const readAt = iss.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('issOut').textContent = `${describePass(look, iss)} Position read at ${readAt}. `
      + (issSamples
        ? 'The ring and the arrow are following it now, and keep following it '
          + 'as it moves — including when it is below the horizon, where the '
          + 'arrow points down through the ground.'
        : 'The orbit could not be fetched, so this is a single reading rather '
          + 'than a moving one, and it goes stale fast: it moves about 7 km a '
          + 'second.');
    if (skyOn) { updateSkyMode(); drawLiveSky(); }
  } catch (err) {
    issOn = false;
    issFix = null;
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

// Both of these rebuild rather than just redraw. The tracks are assembled in
// refreshSkyVectors and gated on these same switches, so a plain redraw left
// the PATHS on screen until the twenty-second tick came round -- the dot
// vanished and its labelled line stayed, which is the one combination the
// tracks were written to avoid.
$('skyPlanets').onclick = () => {
  skyShowPlanets = !skyShowPlanets;
  $('skyPlanets').textContent = skyShowPlanets
    ? 'Hide the planets' : 'Show the planets';
  refreshSkyVectors();
  drawLiveSky();
};
$('skyMoon').onclick = () => {
  skyShowMoon = !skyShowMoon;
  $('skyMoon').textContent = skyShowMoon ? 'Hide the Moon' : 'Show the Moon';
  refreshSkyVectors();
  drawLiveSky();
};

// Twenty-six steps between a 10-degree field and a 140-degree one. It was six
// steps of 15 degrees over 25-110: a jump big enough that the sky leaps rather
// than zooms, with no way to frame one constellation.
const FOV_MIN = 10, FOV_MAX = 170, FOV_STEP = 5;
$('skyWider').onclick = () => {
  skyFov = Math.min(FOV_MAX, skyFov + FOV_STEP); drawLiveSky();
};
$('skyNarrower').onclick = () => {
  skyFov = Math.max(FOV_MIN, skyFov - FOV_STEP); drawLiveSky();
};
// The full-screen corner buttons are the same two actions under a glyph. One
// handler each, delegated, so the limits live in exactly one place.
$('fullIn').onclick = () => $('skyNarrower').click();
$('fullOut').onclick = () => $('skyWider').click();
// And the pan cluster: the pad's own handlers, so the step and the hand-off
// from the sensor live in one place. This is also why the pad can never be
// disabled -- a delegated click on a disabled button goes nowhere.
$('fullUp').onclick = () => $('skyUp').click();
$('fullDown').onclick = () => $('skyDown').click();
$('fullLeft').onclick = () => $('skyLeft').click();
$('fullRight').onclick = () => $('skyRight').click();
$('fullPole').onclick = () => $('skyPole').click();
// One button, two places to press it. Delegating rather than copying the
// behaviour is the same choice the pan cluster makes, and for the same
// reason: two copies are two things to keep in step and the wrong one always
// looks right.
$('fullMode').onclick = () => $('modeBtn').click();

// --- what to point at -------------------------------------------------------
//
// Choosing a target also TRAVELS to it. "Point at the Moon" and "show me the
// Moon" are the same request from where the user is standing, and a ring that
// silently moved off screen would leave only the arrow and no reason for it.

function goToTarget(what, opts) {
  setTarget(what, opts);
  const t = aimTarget(issNow());
  if (t) glideTo(t.az, t.alt);
}

$('tgtPole').onclick = () => $('skyPole').click();
$('tgtMoon').onclick = () => goToTarget('moon');

$('tgtIss').onclick = async () => {
  // Normally already loaded -- the sky fetches it on opening -- but if that
  // failed (no signal then, maybe signal now) this is a request, so it asks.
  if (!issOn) { try { await loadIss({ announce: false }); } catch { /* still none */ } }
  goToTarget('iss');
};

// OUT FROM THE SUN, THEN NOTHING, THEN ROUND AGAIN.
//
// One button walking the list: Mercury first, Pluto last, then the ring is
// cleared, then Mercury again. PLANET_NAMES is already in that order, so the
// cycle reads it rather than keeping a second list that could disagree with
// the one the map draws from. The extra step at the end is the empty one --
// the length plus one is where "nothing" lives.
$('tgtPlanets').onclick = () => {
  planetStep = (planetStep + 1) % (PLANET_NAMES.length + 1);
  const next = planetStep < PLANET_NAMES.length ? PLANET_NAMES[planetStep] : 'none';
  goToTarget(next, { keepCycle: true });
};

// The sky turns a quarter of a degree a minute, so the expensive half is on a
// slow timer while the projection runs per orientation event.
setInterval(() => { if (skyOn) { refreshSkyVectors(); drawLiveSky(); } }, 20000);

// The station crosses the whole sky in minutes, so a target locked to it needs
// recomputing orders of magnitude more often than the stars do. Only while it
// is actually the target -- this is a redraw, and the rest of the time the
// twenty-second timer above is the right rate.
setInterval(() => {
  if (skyOn && guideTarget === 'iss' && issOn) { updateSkyMode(); drawLiveSky(); }
}, 1000);
