// evo.polaris -- app wiring.

import {
  alignmentSolution, julianDay, lstHours, solarNoon, sunNow,
  equatorialToHorizontal, precessionMatrix,
} from './astro.js';
import { declination, modelValidity } from './geomag.js';
import { drawSkyChart, drawReticle } from './chart.js';
import { spellAngle, compassPoint } from './words.js';
import { pointingGuidance, guidanceArrow, guidanceText, signedTurn } from './guide.js';
import {
  buildSkyVectors, smoothAngle, buildMilkyWay, buildBodies, altAzToVector,
  equatorialToVector,
  screenToVector, focalLength, vectorToAltAz,
  clampAim, figureCentre,
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
import {
  drawSkyView, drawMoonDisc, MOON_MIN_ALT, PLANET_MIN_ALT, SUN_MIN_ALT,
} from './skydraw.js';
import { CONSTELLATIONS } from './data/constellations.js';
import { createMilkyWay, galacticBasis } from './milkyway.js';
import { createPlanetArt, CREDIT as PLANET_CREDIT } from './planet-art.js';
import { createConstellationArt, CREDIT as FIGURE_CREDIT } from './constellation-art.js';
import { FIGURES } from './data/figures.js';
import { easeOutCubic, easeInOutCubic, holdSpeed } from './motion.js';
import * as quat from './quat.js';
import {
  moonPhase, describeMoon, sunEquatorial, brightLimbAngle,
  moonRiseSet, describeMoonTimes,
} from './moon.js';
import { planetPositions, describePlanets, PLANET_NAMES, ringOpening } from './planets.js';
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
// after COMPASS_GRACE_MS with nothing heard, because there is no event for
// "no compass here" and silence is the only signal there is. (That sentence
// was in this comment for a long time before it was true: sawSensor only
// triggered a redraw, so a desktop sat in Auto Mode for ever.) Any press on
// the pad takes control back. The accessible layout, for
// people who cannot sweep a phone around, layers on top of that rather than
// replacing it.
let skyFollow = true;
// What the Manual Controls card was last told. null means "never set", so the
// first update opens or shuts it once and then leaves it alone.
let lastFollowMode = null;
// WHERE THE VIEW IS POINTING, AS A ROTATION. See quat.js for why: the short
// version is that a drag used to be found by iterating on two angles, and
// the iteration refused any step the angles could not hold, which put a wall
// at 71 degrees up with the limit at 89, and near the nadir made it answer
// "do not move". It is solved exactly now, and the rotation is the natural
// home for the rest -- a glide is a slerp, the limit is a lean.
//
// skyQuat is the truth. skyAim is derived from it and kept only because the
// readout, the altitude limits and the target maths all speak in angles --
// they read it, nothing writes it but setQuat().
let skyQuat = quat.fromAim(0, 45);
let skyAim = { az: 0, alt: 45 };
// The screen's own frame -- right, forward, up -- which is what the drag
// solver wants the finger's direction in.
const SCREEN_FRAME = quat.basisOf(quat.IDENTITY);

/** Point the view, by rotation. The only writer of skyQuat and skyAim. */
function setQuat(q) {
  skyQuat = quat.clampAltitude(quat.normalize(q), handFloor(), AIM_MAX_ALT);
  // Level, by construction: a sky view has a horizon, and roll is not a
  // freedom it has. Everything that arrives here -- a solved drag, a frame
  // of a glide, a nudge -- leaves level.
  skyQuat = quat.upright(skyQuat);
  const a = vectorToAltAz(quat.basisOf(skyQuat).forward);
  skyAim = { az: a.az, alt: a.alt };
}
// Both on by default: the figures are how people recognise what they are
// looking at, and the band is what most of them are pointing a camera at.
let skyConstellations = true;
// The artwork behind the lines. Remembered, and on to begin with: it is what
// turns a join-the-dots into the figure it is named after, and anyone who
// finds it busy can turn it off in one press.
let skyFigures = store.get('figures', true);
// The figures' corners in the HORIZONTAL frame, rebuilt on the slow tick
// beside the stars. They are stored in equatorial J2000, and the projection
// works in the horizontal frame, so they have to make the same journey
// every star makes -- 84 figures, four corners, a few hundred rotations a
// tick and none at all per frame.
let skyFigureCorners = [];
let skyMilkyWay = true;
// The planets and the Moon are why half of this pane exists now, so both are
// on. They are also the two things that can hide something you were looking
// for -- the Moon is drawn larger than life -- hence the switches.
let skyShowPlanets = true;
let skyShowMoon = true;
// The ground: a solid wireframe Earth below the horizon that hides the sky
// under it, the way the real one does. On by default -- a view that shows
// stars through the ground is a view lying about what you can see -- and
// switchable, because "where is that set planet sitting under the ground" is
// a fair question this app was answering before and can still answer.
let skyGround = true;
let milkyWay = null;
// The Milky Way as a photograph -- see milkyway.js. The procedural `milkyWay`
// above stays: it is what gets drawn if the image never arrives or the GL
// context is lost, so the band is never simply absent. `galactic` is where
// the galactic axes point right now, recomputed with the stars.
// ?nogl=1 forces the JavaScript fallback, which is how that path gets looked
// at on a device that would never otherwise use it.
const milkyLayer = createMilkyWay({
  forceFallback: new URLSearchParams(location.search).get('nogl') === '1',
});
// The planets as textured discs. ?notex=1 forces the old dots, which is how
// that path gets looked at without deleting the file.
const planetArt = createPlanetArt({
  forceOff: new URLSearchParams(location.search).get('notex') === '1',
});
planetArt.ready.then(() => { updateLegend(); if (skyOn) drawLiveSky(); });
// The constellation figures, ghosted behind the stars. ?nofig=1 forces them
// off without touching the saved setting.
const figureArt = createConstellationArt({
  forceOff: new URLSearchParams(location.search).get('nofig') === '1',
});
figureArt.ready.then(() => { updateLegend(); if (skyOn) drawLiveSky(); });
let galactic = null;
milkyLayer.ready.then(() => {
  // Which renderer took the picture, on the root element -- so a test in a
  // real browser can prove WebGL is what is drawing, rather than infer it
  // from the absence of a fallback.
  document.documentElement.dataset.milkyway = milkyLayer.mode;
  updateLegend();
  if (skyOn) drawLiveSky();
});
let skyPlanetList = [];
let skyMoonBody = null;
// The Sun, as a body like the Moon: where it is right now, so the ring and
// the arrow can point at it whether it is up or not.
let skySunBody = null;

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
  // THE CREDIT FOLLOWS THE PICTURE. Shown exactly when the photograph is
  // what is on screen: not while the Milky Way is hidden, and not while the
  // procedural band is standing in for an image that has not arrived -- a
  // credit for a picture that is not there is its own kind of wrong. ESO's
  // terms put it ON the image, so it is on this plate in full screen and
  // spelled out with the link under the map.
  const photo = skyMilkyWay && milkyLayer.mode !== 'none' && milkyLayer.mode !== 'loading';
  $('legMilky').hidden = !photo;
  const credit = $('milkyCredit');
  if (credit) credit.hidden = !photo;
  if (photo) any = true;
  // The planet textures carry their own credit, on the same terms: shown
  // while they are what is being drawn, hidden while the planets are off or
  // the atlas never arrived.
  const textured = skyShowPlanets && planetArt.mode === 'texture';
  const planetCredit = $('legPlanetArt');
  if (planetCredit) {
    planetCredit.textContent = PLANET_CREDIT.replace('Solar System Scope', 'Solar System Scope');
    planetCredit.hidden = !textured;
  }
  if (textured) any = true;
  // And the figures, on the same terms: credited while they are on screen.
  const figures = skyFigures && figureArt.mode === 'figures';
  const figureCredit = $('legFigures');
  if (figureCredit) {
    figureCredit.textContent = FIGURE_CREDIT.replace('James Hedberg', 'James Hedberg');
    figureCredit.hidden = !figures;
  }
  if (figures) any = true;
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

// WHERE THE CONSTELLATIONS BUTTON IS UP TO. Same shape as the planets: one
// button walking the list of shipped figures, in the order they are
// shipped, then nothing, then round again. -1 is "not in the cycle".
const CONST_KEYS = Object.keys(CONSTELLATIONS);
let constStep = -1;

/** Put the ring on something, and take the planet cycle off unless asked. */
function setTarget(what, { keepCycle = false } = {}) {
  guideTarget = what;
  if (!keepCycle) { planetStep = -1; constStep = -1; }
  updateTargetName();
  updateSkyMode();
  drawLiveSky();
}

/**
 * Which target button is lit, and nothing else.
 *
 * There used to be a caption under the buttons naming the target. It is
 * gone: the button that is pressed says which one is live, in green, so the
 * label repeated what was already on screen -- and being a bordered plate
 * the same shape as the buttons above it, it invited a press that did
 * nothing. What it alone carried, that a target has SET, is beside the ring
 * on the map and in the #skyTarget live region.
 */
function updateTargetName() {
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
    ['tgtSun', guideTarget === 'sun'],
    ['tgtPlanets', onPlanet],
    ['tgtConst', guideTarget.startsWith('const:')],
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
  // THE PICTURE CHANGES THEME WITH THE CHROME. data-night restyles every
  // control and plate through CSS the instant it is set; the canvases are
  // painted by script with `night` in hand and stay as they were until
  // something else happens to redraw them. render() above repaints the
  // alignment pane; the sky view had nothing -- a red star field under day
  // chrome until the next tap. Sized as well as drawn, because a text-size
  // change moves the canvas's box without a resize event.
  if (skyOn) { sizeSkyCanvas(); drawLiveSky(); }
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
    // ASK FIRST, DEFER ONLY IF REFUSED. This used to defer without asking
    // whenever there was no gesture, on the belief that requestPermission()
    // existed only on iOS, where a gesture-less call is wasted. Then Chrome
    // 152 grew the same function -- and grants it WITHOUT a gesture -- so on
    // every current Android the view opened in Auto Mode with no listener
    // attached, and nothing moved until the first tap on anything happened
    // to be the deferred ask. Reported as a regression: "you have to go to
    // manual mode and then back to auto mode".
    //
    // A wasted attempt on iOS costs nothing; a skipped attempt on Android
    // cost the compass on load. So the call is always made. On iOS without a
    // gesture it rejects, and THAT is when the ask is deferred to a tap.
    let ok;
    try {
      ok = await DeviceOrientationEvent.requestPermission();
    } catch {
      askOnNextGesture();
      return;
    }
    if (ok !== 'granted') {
      // Only a person can decline. A non-answer to a call that no finger was
      // behind is the same as a rejection: wait for a real gesture.
      if (!gesture) { askOnNextGesture(); return; }
      $('guideText').textContent =
        'Compass permission was declined. The chart and the buttons still work.';
      return;
    }
    compassGranted = true;
  }
  orientEvent = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(orientEvent, onOrientation);
  sensorInfo.event = orientEvent;
  compassOn = true;
  // Listening is not the same as hearing. From here we are entitled to a
  // reading, so start counting.
  watchForNoCompass();
  $('compassBtn').textContent = 'Turn off the compass';
  $('compassBtn').classList.remove('primary');
}

// AUTO MODE NEEDS A SENSOR, AND A DESKTOP WILL NEVER SAY SO.
//
// There is no event for "this device has no compass" -- readings simply never
// arrive, which is indistinguishable from one that has not reported YET until
// enough time passes. So the app sat in Auto Mode for ever on every desktop,
// following nothing, with the button offering to switch to Manual as though
// Auto were working. The comment on skyFollow claimed this fallback already
// existed; sawSensor only ever triggered a redraw, so it did not.
//
// Reported obliquely -- "click and click drag works in auto-mode on PC, do we
// care since auto can't work on pc?". The gestures were right: they are the
// only way to steer where nothing is steering. It was the MODE that was lying.
const COMPASS_GRACE_MS = 2500;
let compassWatchdog = null;
// Once per page, and only for the attempt the view makes by itself. Someone
// who PRESSES Use Auto Mode on a laptop has been told what this device can do
// and is entitled to be left there; yanking them back would read as the
// button not working.
let autoFellBack = false;

function watchForNoCompass() {
  if (autoFellBack || compassWatchdog !== null) return;
  compassWatchdog = setTimeout(() => {
    compassWatchdog = null;
    if (rawAlpha !== null) return;       // it reported after all
    if (!skyFollow) return;              // already steering by hand
    // NOT WHILE A HUMAN IS THE REASON. On iOS nothing arrives until the
    // permission tap, and dropping to Manual while the prompt is still owed
    // would answer a question the user has not been asked yet.
    if (compassPending) return;
    if (compassNeedsAsking() && !compassGranted) return;
    autoFellBack = true;
    skyFollow = false;
    updateSkyMode();
    drawLiveSky();
  }, COMPASS_GRACE_MS);
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
  // It reported, so the "this device has no compass" countdown is moot.
  if (compassWatchdog !== null) {
    clearTimeout(compassWatchdog);
    compassWatchdog = null;
  }

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
  // The artwork turns with the sky, exactly as the stars do.
  skyFigureCorners = FIGURES.map((f) => ({
    i: f.i,
    c: f.c.map((v) => equatorialToVector(
      Math.atan2(v[1], v[0]) * 180 / Math.PI,
      Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI,
      lst, site.lat, precess,
    )),
  }));
  // Same slow tick as the stars: the band turns with the sky, not with you.
  milkyWay = buildMilkyWay(lst, site.lat, 6, 3, 18, precess);
  galactic = galacticBasis(lst, site.lat, precess);

  // The planets and the Moon move against the stars, so they are rebuilt on
  // the same tick rather than cached alongside them. Both go through the same
  // rotation the stars do -- one implementation, so they cannot disagree.
  const ph = moonPhase(when);
  const sunNow = sunEquatorial(when);
  const bodies = buildBodies([
    // THE PHASE IS REAL, even though the face is not. Mercury and Venus show
    // crescents from inside Earth's orbit, and the phase angle is already
    // computed for the magnitude -- illuminated fraction is (1 + cos a) / 2.
    // The lit side is measured against the projection exactly as the Moon's
    // is, through the same function.
    ...planetPositions(when).map((p) => ({
      ...p,
      illuminated: (1 + Math.cos(p.phaseAngle * Math.PI / 180)) / 2,
      brightLimb: brightLimbAngle(p, sunNow),
      ringTilt: p.name === 'Saturn' ? ringOpening(p) : null,
    })),
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
  // The Sun's series is of date, like the Moon's, so it is not precessed
  // again -- the same flag, for the same reason.
  const sunEq = sunEquatorial(appTime());
  skySunBody = buildBodies([{ ra: sunEq.ra, dec: sunEq.dec, frame: 'date', isSun: true }],
                           lst, site.lat, precess)[0] || null;
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

// THE CANVAS CAN LOSE ITS CONTEXT, AND THEN DRAWS NOTHING UNTIL TOLD TO
// COME BACK. Chrome on Android drops a canvas's GPU context under memory
// pressure, and a switch in or out of real full screen is exactly when it is
// reallocating two full-screen canvases at once. A lost 2D context throws no
// error: every draw call is silently ignored, so the sky was black -- in the
// window, and in full screen again -- until the page was reloaded. "So
// exiting full screen breaks and can't be fixed."
//
// The WebGL layer has handled its own loss since it was written; the 2D
// canvas had not. Cancelling contextlost is the whole contract: it tells the
// browser the page intends to carry on, and the browser then restores the
// context and says so -- at which point the backing store is blank and
// everything has to be drawn again. Without the cancel, no restore ever
// comes. Not reproducible on a desktop, which never loses one; the count on
// the diagnostics line is there so a recurrence can be named.
let canvasLosses = 0;
$('liveSky').addEventListener('contextlost', (e) => {
  e.preventDefault();
  canvasLosses += 1;
  noteCanvasLoss();
});
$('liveSky').addEventListener('contextrestored', () => {
  sizeSkyCanvas();
  drawLiveSky();
  noteCanvasLoss();
});

/** The breadcrumb: how many times, and whether the picture is back yet. */
function noteCanvasLoss() {
  const el = $('skyDiag');
  if (!el || !canvasLosses) return;
  const lost = $('liveSky').getContext('2d')?.isContextLost?.() === true;
  el.textContent = `Canvas context lost ${canvasLosses}× — `
    + (lost ? 'waiting for the browser to give it back.' : 'restored and redrawn.');
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
    fullOn ? 'Exit full screen' : 'Fill the screen');
  // The word under the glyph says the same thing the name does.
  const tag = $('fullBtnTag');
  if (tag) tag.textContent = fullOn ? 'Exit' : 'Full screen';
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
  // The draw reports where it actually pointed, in either mode, and the
  // numbers on the plate come from that -- not from skyAim, which the phone
  // never writes.
  const painted = drawSkyView(c.getContext('2d'), {
    basis: useDevice ? null : aimBasis(),
    screenAngle: sensorInfo.screen,
    sky: skyVectors,
    alpha: sAlpha ?? rawAlpha ?? 0,
    beta: sBeta ?? tilt ?? 90,
    gamma: sGamma ?? roll ?? 0,
    declination: solution.declination,
    // NO TARGET IS A REAL ANSWER, and aimTarget says so by returning null --
    // which this line then dereferenced, so pressing the active target to
    // let it go threw on every frame from then on. The readout kept
    // changing, the picture never repainted: "the screen freezes". The
    // draw already knows how to have no ring and no pointer; it just had to
    // be told with a null instead of an exception.
    targetAlt: target ? target.alt : null,
    targetAz: target ? target.az : null,
    // The same words as the caption under the buttons, from the same call:
    // the label on the picture is the one actually being read while looking
    // at an empty ring, and a bare "Moon" there is the app naming something
    // it has not drawn.
    targetName: targetLabel(target),
    // THE RETICLE IS THE SAME SIZE ON SCREEN IN EVERY MODE.
    //
    // It used to be min(canvas)/14, which grows when the canvas does: on this
    // 1280x800 desktop that was 71 CSS px across windowed and 114 full
    // screen, reported as "it's very large on pc in full screen". Keying it
    // to the VIEWPORT instead holds it still, because going full screen
    // changes the canvas and not the window -- 57 px in both.
    //
    // The viewport's short side, so turning a phone does not resize it
    // either. On a 390x844 phone that is 390/14 = 28 CSS px, which at dpr 2
    // is the 56 device px the ring measured everywhere except the one case
    // that was reported as too big.
    reticleR: (Math.min(window.innerWidth, window.innerHeight)
               * Math.min(window.devicePixelRatio || 1, 2)) / 28,
    w: c.width, h: c.height, fov: skyFov, night,
    constellations: skyConstellations,
    figureArt: skyFigures && figureArt.mode === 'figures' ? figureArt : null,
    figures: skyFigureCorners,
    milkyWay: skyMilkyWay ? milkyWay : null,
    milkyLayer: skyMilkyWay ? milkyLayer : null,
    galactic,
    ground: skyGround,
    tracks: skyTracks,
    planets: skyShowPlanets ? skyPlanetList : null,
    planetArt: skyShowPlanets && planetArt.mode === 'texture' ? planetArt : null,
    moon: skyShowMoon ? skyMoonBody : null,
    sun: skySunBody,
    // The marker is only drawn when the station is actually up there --
    // a dot below the horizon would be drawing the inside of the Earth. The
    // TARGET is not so restricted: see below.
    iss: issLook && issLook.aboveHorizon
      ? { alt: issLook.alt, az: issLook.az, sunlit: issLook.sunlit } : null,
  });
  showReadout(painted.aimedAz, painted.aimedAlt);
}

/**
 * The numbers on the picture: where the view is pointing, right now.
 *
 * In Manual Mode this is where the hand has put the view; in Auto Mode it is
 * the phone's own heading and tilt, corrected for declination -- the pair of
 * numbers a polar-alignment app is actually for, and until now the one thing
 * the picture did not say. It is also the instrument: every rotation bug so
 * far was diagnosed by scraping this pair out of a hidden hint with synthetic
 * pointer events, and now it is on the screen where a thumb can find it.
 *
 * Whole degrees. The compass is honest to about two on a good day and the
 * hand to about one, and a decimal that flickers is worse than none.
 */
function showReadout(az, alt) {
  const el = $('skyReadout');
  if (!el) return;
  const round = ((Math.round(az) % 360) + 360) % 360;
  $('rdAz').textContent = `${round}° ${compassPoint(round)}`;
  $('rdAlt').textContent = `${Math.round(alt)}°`;
  el.hidden = false;
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
  if (guideTarget === 'sun') {
    return skySunBody
      ? { alt: skySunBody.alt, az: skySunBody.az, name: 'Sun' }
      : poleTarget();
  }
  if (guideTarget.startsWith('const:')) {
    // The middle of the figure, from the same star vectors the lines are
    // drawn from, so the ring lands inside what is on screen.
    const key = guideTarget.slice(6);
    const fig = CONSTELLATIONS[key];
    if (fig && skyVectors) {
      const byHr = new Map(skyVectors.map((s) => [s.hr, s.v]));
      const c = figureCentre(fig.lines, byHr);
      if (c) { const { alt, az } = vectorToAltAz(c); return { alt, az, name: fig.name }; }
    }
    return poleTarget();
  }
  const planet = (skyPlanetList || []).find((b) => b.name === guideTarget);
  if (planet) return { alt: planet.alt, az: planet.az, name: planet.name };
  return poleTarget();
}

/**
 * Is the thing the ring is on actually painted on the map?
 *
 * "moon is gone" -- it was 57 degrees under the ground, drawn by nobody and
 * explained by nothing. The gates are imported from the renderer rather than
 * repeated here: a copy of a threshold is a copy that drifts, and the one
 * place it had already drifted was the label reserver, which kept room for a
 * "Moon" it never painted.
 */
function targetLabel(t) {
  if (!t) return '';
  return targetIsPainted(t) ? t.name : `${t.name} — has set`;
}

function targetIsPainted(t) {
  if (!t) return false;
  if (guideTarget === 'moon') return t.alt > MOON_MIN_ALT;
  if (guideTarget === 'sun') return t.alt > SUN_MIN_ALT;
  // A figure is a place in the sky rather than a body, but a figure whose
  // middle is under the ground is one you cannot see either.
  if (guideTarget.startsWith('const:')) return t.alt > 0;
  if (PLANET_NAMES.includes(guideTarget)) return t.alt > PLANET_MIN_ALT;
  return true;                     // the pole is a place, not a body; the ISS
}                                  // has said this for itself all along

function aimAtPole() {
  if (!solution) return;
  // Clamped like every other way of aiming. At the poles the setting is 90,
  // which is past where the arrows are allowed to go -- and an aim the buttons
  // cannot hold is an aim they cannot take back over from.
  setQuat(quat.fromAim(solution.poleAzimuth, Math.abs(solution.latitudeSetting)));
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
  const ringOn = solution ? aimTarget(issLook) : null;
  if (guideTarget === 'iss' && issLook) {
    const az = Math.round((issLook.az + 360) % 360);
    $('skyTarget').textContent = issLook.aboveHorizon
      ? `Tracking the ISS: ${az}° round, ${Math.round(issLook.alt)}° up.`
      : `Tracking the ISS: ${az}° round and ${Math.round(-issLook.alt)}° BELOW `
        + 'the horizon — it is under the ground from here, and the arrow '
        + 'points down at it. Press "Find the pole" to go back.';
  } else if (ringOn && !targetIsPainted(ringOn)) {
    // THE SAME COURTESY THE ISS HAS ALWAYS HAD, FOR EVERYTHING ELSE. The ring
    // lands on the Moon or a planet, the caption names it, and the circle is
    // empty because the body is under the ground. Without this the app reads
    // as broken at the exact moment it is being most accurate.
    const az = Math.round(((ringOn.az % 360) + 360) % 360);
    $('skyTarget').textContent =
      `${ringOn.name}: ${az}° round and ${Math.round(-ringOn.alt)}° BELOW the `
      + 'horizon — it is under the ground from here, so the ring is empty and '
      + 'the arrow points down at it. It is not missing; it has set.';
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
    // The second case is PERMANENT on a device without one, not a pause, so
    // this text has to leave the reader somewhere to go. It used to end "the
    // arrows work meanwhile", which was true when the pad was always on
    // screen and false once it moved inside a collapsed card -- so it names
    // the card now.
    $('skyMode').textContent =
      compassPending
        ? `${when}Auto Mode is on. Tap anywhere to let this phone share which `
          + 'way it is pointing — it will ask once. The arrows under Manual '
          + 'Controls work either way.'
        : `${when}Auto Mode is on, waiting for the phone's compass. If nothing `
          + 'moves, this device is not reporting one — open Manual Controls '
          + 'below, or press Use Manual Mode, and the arrows steer it.';
  } else {
    $('skyMode').textContent = autoFellBack
      ? `${when}Manual Mode — this device does not report which way it is `
        + `pointing, so Auto Mode had nothing to follow. `
        + `${aimed.slice(when.length)}`
      : `${when}Manual Mode. ${aimed.slice(when.length)}`;
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
  //
  // FROM skyFollow, THE MODE -- NOT `following`, WHICH IS THE MODE AND A
  // READING HAVING ARRIVED. On load skyFollow is already true and rawAlpha is
  // still null, so `following` is false and the card sprang open while the
  // button beside it said Auto Mode: "manual controls are expanded on load but
  // system is in auto mode". The same trap was caught once already for the
  // button's own label, and the note about it is six lines below this.
  if (skyFollow !== lastFollowMode) {
    lastFollowMode = skyFollow;
    const card = $('manualCard');
    if (card) card.open = !skyFollow;
  }
  $('fullPan').hidden = following;
  // The browser hands the map the pointer only while a hand is steering:
  // that is when a finger on it means "move the sky" and not "scroll".
  $('liveSkyWrap').classList.toggle('steering', !following);
  // THE PAD IS NEVER DISABLED. It used to be greyed out while the phone was
  // steering, and on a dark screen at arm's length greyed reads as gone --
  // "the controls to move the screen are not visible". Worse, it contradicted
  // pan() two functions down, which has always dropped follow mode on a press:
  // disabling the buttons made that hand-off unreachable from the one place
  // anyone would look for it, and left "Stop following the phone", a different
  // button in a different place, as the only way back. A press now means what
  // it says: the buttons take over.
}

// How far the view may be pointed. The pad, a tap and a drag all end up in
// setQuat, so they reach exactly the same places -- not tidiness, a rule: a
// drag must never get somewhere the buttons cannot.
//
// THERE USED TO BE A SECOND, TIGHTER FLOOR FOR HAND STEERING, at -30: far
// enough to see something under the horizon, near enough that nobody got
// lost in featureless ground. Two things took the reason away. The ground is
// a see-through wireframe now, so below the horizon is not blank any more;
// and targets legitimately live down there -- the Sun at night sits near
// -59 -- so the app was already sending people somewhere their own hands
// could not follow them back from. It also cost a real bug: a floor that had
// to be computed from where the view WAS, which ratcheted and froze the
// controls outright.
const AIM_MAX_ALT = 89;
// Straight down is 90, and the last degree is left alone at both ends. The
// view is perfectly well defined pointing at the zenith now -- that is the
// whole point of holding it as a rotation -- but "which way round am I
// facing" is not, and the readout has to say something.
const TARGET_MIN_ALT = -89;

/**
 * How far down steering may go -- the same for a hand as for a target.
 *
 * It was once a function of where the view already was, so that hands were
 * fenced at -30 while a target could go deeper. A limit computed from the
 * current position RATCHETS: at -59 the floor was -59, so down did nothing;
 * a nudge up to -44 made the floor -44, so down did nothing again. Targeting
 * the Sun at night lands at about -59, and the first thing anyone does there
 * is drag downward. A purely vertical finger does not change azimuth either,
 * so the whole view appeared frozen -- "the manual buttons and drag do not
 * work, they do nothing". One fixed limit cannot do that.
 */
const handFloor = () => TARGET_MIN_ALT;

function setAim(az, alt) {
  // Any hand steering drops out of follow mode: the alternative is fighting
  // the sensor for control, which is worse than either mode alone.
  cancelGlide();                 // a hand on the controls beats an animation
  if (!flingOwnMove) cancelFling();   // ...and beats a coast, but is not one
  skyFollow = false;
  setQuat(quat.fromAim(az, alt));
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
// 450 to start with, halved to 900 on "it scrolls way too fast", then 1125,
// then this. Each step was asked for after using it, which is the only way
// this number was ever going to be found.
const GLIDE_MS = 1406;
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
// --- letting go of a drag ---------------------------------------------------
//
// A drag that stops dead the instant the finger leaves is a drag that fights
// you: the sky is a big thing to move, the screen is small, and crossing it
// means several strokes where the physical gesture is one. Reported as "on
// click drag it just stops when released, it should de-accelerate".
//
// NOT AN EASING. A glide has a destination and eases INTO it; this has no
// destination at all -- it carries the speed the hand was already moving at
// and bleeds it away, so where it stops depends on how hard it was thrown.
// That is the whole difference between a fling and an animation, and it is
// why it gets its own handle rather than borrowing the glide's.
const FLING_TAU = 220;        // ms for the speed to fall to about a third
const FLING_MIN = 0.004;      // deg/ms -- below this it has stopped
const FLING_MAX_MS = 900;     // a hard end, so nothing coasts for ever
// A finger that came to rest before lifting threw nothing. Without this, a
// careful drag-and-hold ends with the sky drifting away under the hand.
const FLING_STALE_MS = 90;
let fling = null;             // { raf } while coasting
// setAim cancels a fling, because a hand on the controls beats an animation.
// The fling steers THROUGH setAim, so it has to be able to say "this one is
// me" -- otherwise its own first frame would cancel it.
let flingOwnMove = false;

function cancelFling() {
  if (!fling) return;
  cancelAnimationFrame(fling.raf);
  fling = null;
}

/** Coast on from a release, in degrees per millisecond. */
function flingFrom(vAz, vAlt) {
  cancelFling();
  // Same rule as the glide: a large moving field is a vertigo trigger, and
  // motion nobody asked to continue is the easiest kind to do without.
  if (wantsStill() || document.hidden) return;
  if (Math.hypot(vAz, vAlt) < FLING_MIN) return;
  const started = performance.now();
  let prev = started;
  const step = (now) => {
    // Clamped, because a dropped frame must not teleport the sky.
    const dt = Math.min(now - prev, 50);
    prev = now;
    const k = Math.exp(-(now - started) / FLING_TAU);
    if (Math.hypot(vAz, vAlt) * k < FLING_MIN || now - started > FLING_MAX_MS) {
      fling = null;
      return;
    }
    flingOwnMove = true;
    setAim(skyAim.az + vAz * k * dt, skyAim.alt + vAlt * k * dt);
    flingOwnMove = false;
    fling = { raf: requestAnimationFrame(step) };
  };
  fling = { raf: requestAnimationFrame(step) };
}

function cancelGlide(arrive = false) {
  if (glide === null) return;
  cancelAnimationFrame(glide.raf);
  const { to } = glide;
  glide = null;
  if (arrive) {
    setQuat(quat.fromAim(to.az, to.alt));
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
function glideTo(az, alt, { ms = GLIDE_MS, ease = easeOutCubic } = {}) {
  cancelGlide();
  // The destination is clamped HERE as well as in setQuat, and not by
  // accident: the journey has to know where it is going before it starts, or
  // an unreachable target would be eased towards for the full 900ms and then
  // land somewhere else. It took a `floor` argument until hand steering and
  // targets stopped having different floors.
  const to = clampAim(az, alt, TARGET_MIN_ALT, AIM_MAX_ALT);
  const from = { ...skyAim };
  const dAz = signedTurn(from.az, to.az);
  const dAlt = to.alt - from.alt;
  skyFollow = false;
  // Already there, asked to hold still, or nobody is looking: no animation to
  // run. A hidden tab gets no animation frames at all, so starting a journey
  // in one only strands the view until it comes back.
  if (wantsStill() || document.hidden
      || (Math.abs(dAz) < 0.5 && Math.abs(dAlt) < 0.5)) {
    setQuat(quat.fromAim(to.az, to.alt));
    updateSkyMode();
    drawLiveSky();
    return;
  }
  // The journey is a rotation too: slerp takes the short way round without
  // anyone having to think about the 360 seam, and it cannot produce an
  // orientation the angles could not express.
  const fromQ = skyQuat;
  const toQ = quat.fromAim(to.az, to.alt);
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / ms);
    // The journey eases OUT: leaves quickly, settles gently, which reads as
    // the sky coming to rest. A nudge eases in AND out, because a press
    // should not lurch. Constant speed reads as a machine moving the sky.
    const e = ease(t);
    setQuat(quat.slerp(fromQ, toQ, e));
    updateSkyMode();
    drawLiveSky();
    glide = t < 1 ? { raf: requestAnimationFrame(step), to } : null;
  };
  glide = { raf: requestAnimationFrame(step), to };
}

function pan(dAz, dAlt) {
  setAim(skyAim.az + dAz, skyAim.alt + dAlt);
}

// --- pressing an arrow ------------------------------------------------------
//
// "In manual mode if you press the arrow, it snaps to the point. I would
// really prefer it to just slowly accelerate and stop." And then: "this
// should be much more fluid than it is."
//
// An arrow used to cut fifteen degrees per press. Now a PRESS is a nudge --
// the same fifteen degrees, travelled with an ease-in-and-out so it neither
// lurches nor stops dead -- and a HOLD is a hold: the sky starts moving,
// ramps up to a cruising speed while the finger stays down, and when it
// lifts the movement coasts out through the same momentum a released drag
// has. The finger decides how far; nothing snaps.
//
// Both go through the same limits as the pad always has (the hand floor, not
// the target floor), so the arrows still reach exactly the places a tap or a
// drag can and no further. The keyboard gets both as well -- keydown holds,
// keyup releases -- so nothing here is a capability that belongs only to a
// finger.
const NUDGE_MS = 380;         // one press: long enough to see, short enough to feel
const HOLD_RAMP_MS = 600;     // "slowly accelerate"
const HOLD_CRUISE = 0.06;     // deg/ms once ramped: a full field in about a second
const TAP_HOLD_MS = 220;      // shorter than this, the press was a tap, not a hold

function nudge(dAz, dAlt) {
  glideTo(skyAim.az + dAz, skyAim.alt + dAlt,
          { ms: NUDGE_MS, ease: easeInOutCubic });
}

let hold = null;              // { dAz, dAlt, t0, prev, raf, v }

function holdStart(dAz, dAlt) {
  if (hold) return;
  cancelGlide();
  cancelFling();
  const t0 = performance.now();
  hold = { dAz, dAlt, t0, prev: t0, raf: 0, v: { az: 0, alt: 0 } };
  const step = (now) => {
    if (!hold) return;
    const dt = Math.min(now - hold.prev, 50);     // a dropped frame must not jump
    hold.prev = now;
    const speed = holdSpeed(now - hold.t0, { ramp: HOLD_RAMP_MS, cruise: HOLD_CRUISE });
    hold.v = { az: hold.dAz * speed, alt: hold.dAlt * speed };
    pan(hold.v.az * dt, hold.v.alt * dt);
    hold.raf = requestAnimationFrame(step);
  };
  hold.raf = requestAnimationFrame(step);
}

/** The finger lifted: a tap becomes a nudge; a hold coasts to a stop. */
function holdEnd() {
  if (!hold) return;
  const h = hold;
  hold = null;
  cancelAnimationFrame(h.raf);
  if (performance.now() - h.t0 < TAP_HOLD_MS) {
    nudge(h.dAz * STEP, h.dAlt * STEP);
    return;
  }
  // "...and stop" -- but not dead. The same coast a released drag gets,
  // which also means the same respect for reduced motion: there it stops
  // at once.
  flingFrom(h.v.az, h.v.alt);
}

/**
 * Wire one arrow: pointer for the finger, keyboard for the rest, and a plain
 * click for assistive tech that synthesises one without any pointer at all.
 */
function wireArrow(id, dAz, dAlt) {
  const el = $(id);
  if (!el) return;
  let pointerHandled = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointerHandled = performance.now();
    // Capture keeps the release arriving here even if the finger slides off
    // the button -- but capture can THROW, for a pointer the browser does not
    // consider active (assistive tech, and anything synthesising events).
    // Thrown before the hold started, it aborted the press and left the
    // fallback click marked as already handled: the arrow did nothing at
    // all. The hold must start whether or not capture is granted.
    try { el.setPointerCapture(e.pointerId); } catch { /* no capture, still a press */ }
    holdStart(dAz, dAlt);
  });
  const up = () => holdEnd();
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  // A click that no pointer press produced -- a screen reader, or Enter and
  // Space on the focused button -- is one press: one nudge.
  el.addEventListener('click', () => {
    if (performance.now() - pointerHandled < 600) return;
    nudge(dAz * STEP, dAlt * STEP);
  });
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
  return quat.basisOf(skyQuat);
}

$('liveSky').addEventListener('pointerdown', (e) => {
  // A finger back on the glass stops the coast where it is, the way it stops
  // a spinning wheel. Before handSteering(), so it stops even where a drag
  // would not start.
  cancelFling();
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
    // WHAT WAS UNDER THE FINGER WHEN IT WENT DOWN, as a direction in the
    // world. Every move solves against THIS, not against the previous event:
    // stepping from the last position rounds once per event, and thirty of
    // those compound into a drift the finger never asked for.
    grabbed: screenToVector(at.x, at.y, basis, focal),
  };
});

window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  // WINDOWED TOO. The drag was full-screen only from the day it was added,
  // so a finger across the small map would still scroll the page. "Manual
  // mode no longer works unless I'm full screen" -- to the person it is for,
  // a map that steers in one size and scrolls in the other is a broken map.
  // The page still scrolls from anywhere that is not the map, and in Auto
  // Mode the map still scrolls it, because nothing steers there: the
  // pointer is only taken (touch-action) while the hand is steering.
  const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (moved < TAP_SLOP) return;              // still a tap, as far as anyone knows
  const at = mapOffset(e);
  if (!at) return;
  // A hand on the sky beats the sensor and any animation. setAim used to do
  // this on the way past; the drag no longer goes through it.
  cancelGlide();
  if (!flingOwnMove) cancelFling();
  skyFollow = false;
  // SOLVED, NOT SEARCHED FOR. The level view that puts the grabbed star
  // under the finger has a closed form -- see quat.aimLevel. The old solver
  // iterated six times, kept its best miss, and refused outright any step
  // whose answer the angles could not hold, which is where the wall at 71
  // degrees came from with the limit at 89. Where the finger asks for the
  // impossible -- a high star at the edge of a level screen, or past the
  // zenith -- this gives the nearest view instead of no view.
  const q = quat.aimLevel(drag.grabbed,
    screenToVector(at.x, at.y, SCREEN_FRAME, drag.focal),
    skyQuat, handFloor(), AIM_MAX_ALT);
  if (q) setQuat(q);
  // setAim used to do these two as well, and the drag no longer goes through
  // it. Found in a browser, not by the suite: without them the readout and
  // the picture stood still while the finger moved, and updated only on the
  // release.
  updateSkyMode();
  drawLiveSky();
  const { az, alt } = skyAim;
  // How fast the sky is being moved, for the coast after the release. In
  // DEGREES, not pixels, because that is what the release has to keep moving
  // -- and through signedTurn, or a drag across due north reads as a 359
  // degree lurch the other way.
  const now = performance.now();
  if (drag.prev) {
    const dt = now - drag.prev.t;
    if (dt > 0) {
      const v = { az: signedTurn(drag.prev.az, az) / dt, alt: (alt - drag.prev.alt) / dt };
      // Lightly smoothed: one jittery frame at the moment of release should
      // not decide which way the sky sails off.
      drag.v = drag.v
        ? { az: drag.v.az * 0.6 + v.az * 0.4, alt: drag.v.alt * 0.6 + v.alt * 0.4 }
        : v;
    }
  }
  drag.prev = { t: now, az, alt };
});

window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  const d = drag;
  drag = null;
  // A swipe is not a tap even where dragging is switched off, or scrolling the
  // page windowed would fling the view somewhere on release.
  if (far >= TAP_SLOP || !handSteering()) {
    // It was a swipe: keep going, and slow down -- in either size, now that
    // the drag steers in either.
    const fresh = d.prev && (performance.now() - d.prev.t) < FLING_STALE_MS;
    if (handSteering() && d.v && fresh) flingFrom(d.v.az, d.v.alt);
    return;
  }
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
  // The coast simply ends: unlike a journey it has nowhere it was going, so
  // there is nothing to land and finishing it on return would move the sky
  // for a gesture made minutes ago.
  if (document.hidden) { cancelFling(); cancelGlide(true); return; }
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
    + ` gamma ${Math.round(sGamma ?? 0)}° · screen ${sensorInfo.screen}°${warn}`
    // Auto Mode rewrites this line every frame; the breadcrumb rides on it.
    + (canvasLosses ? ` · canvas context lost ${canvasLosses}×` : '');
}

const STEP = 15;
// Direction as a unit, not a distance: a press moves STEP degrees, a hold
// moves as far as it is held. Both pads, so the full-screen arrows hold too.
for (const [id, dAz, dAlt] of [
  ['skyUp', 0, 1], ['skyDown', 0, -1], ['skyLeft', -1, 0], ['skyRight', 1, 0],
  ['fullUp', 0, 1], ['fullDown', 0, -1], ['fullLeft', -1, 0], ['fullRight', 1, 0],
]) wireArrow(id, dAz, dAlt);
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
    ArrowUp: [0, 1], ArrowDown: [0, -1],
    ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  };
  if (!moves[e.key]) return;
  e.preventDefault();
  // The key going down starts a hold, exactly like a finger; the OS's own
  // auto-repeat is ignored, because the hold is already moving.
  if (!e.repeat) holdStart(...moves[e.key]);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') holdEnd();
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
/**
 * The art toggle's label, from the setting rather than from the markup.
 *
 * This is the ONLY one of these switches whose state is remembered, and it
 * shipped saying "Hide the constellation art" on every load -- the static
 * text in the HTML -- however it had been left. Turn the art off, reload,
 * and the button claimed it was on while the sky said otherwise: the exact
 * mix of "what pressing does" and "the state you are in" the button rule
 * exists to forbid.
 */
function applyFiguresLabel() {
  const label = skyFigures
    ? 'Hide the constellation art' : 'Show the constellation art';
  $('skyFigures').textContent = label;
  // The full-screen glyph carries the same words for a screen reader and the
  // same state, so the two can never disagree about what pressing does.
  const full = $('fullFigures');
  if (full) {
    full.setAttribute('aria-label', label);
    full.title = label;
  }
}
applyFiguresLabel();

$('skyFigures').onclick = () => {
  skyFigures = !skyFigures;
  store.set('figures', skyFigures);
  applyFiguresLabel();
  updateLegend();
  drawLiveSky();
};
$('skyMilky').onclick = () => {
  skyMilkyWay = !skyMilkyWay;
  $('skyMilky').textContent = skyMilkyWay
    ? 'Hide the Milky Way' : 'Show the Milky Way';
  updateLegend();                 // the credit goes with the picture
  drawLiveSky();
};
$('skyGround').onclick = () => {
  skyGround = !skyGround;
  // "Horizon" is the word on the button in full screen, so it is the word
  // in the accessible name too -- one control, one name.
  const label = skyGround ? 'Hide the horizon' : 'Show the horizon';
  $('skyGround').textContent = label;
  // The full-screen glyph carries the same words for a screen reader, and
  // the same state, so the two can never disagree about what pressing does.
  const full = $('fullGround');
  if (full) {
    full.setAttribute('aria-label', label);
    full.title = label;
  }
  drawLiveSky();
};
// One control, two places. The full-screen button is a glyph because the
// corner has no room for words; it presses the real one.
$('fullGround').onclick = () => $('skyGround').click();
// Same arrangement for the artwork: one control, pressed from either place.
$('fullFigures').onclick = () => $('skyFigures').click();

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
// The four arrows are wired by wireArrow() above, both pads alike -- a
// press and a hold are pointer events, and a click delegated from here to
// the windowed pad would fire on top of them and nudge twice. The pole
// button has no hold, so it still simply presses its twin.
$('fullPole').onclick = () => $('skyPole').click();
// One button, two places to press it. Delegating rather than copying the
// behaviour is the same choice the pan cluster makes, and for the same
// reason: two copies are two things to keep in step and the wrong one always
// looks right.
$('fullMode').onclick = () => $('modeBtn').click();

// THE TRACK LIST ROLLS UP AND DOWN. One press on the heading opens the six
// target buttons, the next closes them. Closed by default, because the
// screen was "getting really crowded", and remembered, because someone who
// keeps it open wants it open. The mode switch is NOT in the list: it is how
// you hand the sky back to the phone, and it stays where a thumb can find it
// whether the list is open or not.
function applyTrackOpen(open) {
  $('trackHead').setAttribute('aria-expanded', String(open));
  $('targetGrid').hidden = !open;
}
$('trackHead').onclick = () => {
  const open = $('trackHead').getAttribute('aria-expanded') !== 'true';
  applyTrackOpen(open);
  store.set('trackOpen', open);
};
applyTrackOpen(store.get('trackOpen', false) === true);

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

// PRESS THE ACTIVE TARGET AGAIN AND IT LETS GO. "When you select a target,
// if you press again it should deselect it." A pressed button that does
// nothing on a second press is a switch with no off; the ring comes off and
// the view stays where it is. The Planets button is the one exception --
// it walks the list, and letting go is the last stop on the walk.
$('tgtPole').onclick = () => {
  if (guideTarget === 'pole') { setTarget('none'); return; }
  $('skyPole').click();
};
$('tgtMoon').onclick = () => goToTarget(guideTarget === 'moon' ? 'none' : 'moon');

$('tgtIss').onclick = async () => {
  if (guideTarget === 'iss') { setTarget('none'); return; }
  // Normally already loaded -- the sky fetches it on opening -- but if that
  // failed (no signal then, maybe signal now) this is a request, so it asks.
  if (!issOn) { try { await loadIss({ announce: false }); } catch { /* still none */ } }
  goToTarget('iss');
};

// "It should always point at the sun, even during the day it would be
// above the horizon." Pressing the Sun again lets go, as the others do.
$('tgtSun').onclick = () => goToTarget(guideTarget === 'sun' ? 'none' : 'sun');

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
  constStep = -1;
  goToTarget(next, { keepCycle: true });
};

// "A constellation button that snaps to each one with its name." One
// button walking the shipped figures, the ring on the middle of each, the
// name as the caption; after the last, nothing, then round again. It
// travels there rather than snapping, like everything else does now.
$('tgtConst').onclick = () => {
  constStep = (constStep + 1) % (CONST_KEYS.length + 1);
  const next = constStep < CONST_KEYS.length ? 'const:' + CONST_KEYS[constStep] : 'none';
  planetStep = -1;
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
