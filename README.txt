evo.polaris
===========

Free, open-source polar alignment for star trackers and equatorial mounts —
built to be usable by astronomers who can't crouch behind an eyepiece, hold a
phone steady, or work a fiddly touch target in the dark.

Every app that does this today costs money and assumes a body that cooperates.
This one is free, works offline, reads its numbers out loud, and never asks you
to drag, pinch, double-tap or press-and-hold.

What it tells you
-----------------

Give it your position and it produces the three numbers you actually dial into
a mount:

| Number | What it is |
| --- | --- |
| Latitude / altitude knob | Your latitude. Sets the RA axis parallel to the Earth's. |
| Compass bearing for true north | Magnetic declination is corrected on-device, so the azimuth you set is true north and not magnetic north. |
| Polaris on the reticle | Clock position and radius on the 12-hour iOptron AccuAlign dial, drawn as well as written. |

Plus a live sky chart of the circumpolar sky with the Big Dipper star-hop drawn
on it, and — with the compass on — arrows telling you which way to turn.

Finding true north without a compass
------------------------------------

A desktop browser has no magnetometer, and plenty of phones have a bad one, so
the app never assumes you have a working compass. It offers three routes:

- Polaris itself. Polaris sits about 0.6° from the true pole, so pointing at
  it is pointing true north. People assume they need north in order to find
  Polaris; it works the other way round — star-hop to it from the Big Dipper
  using the chart and you are aligned, with no compass and no declination
  correction anywhere in the loop.
- A shadow at solar noon. The app computes the exact moment the Sun crosses
  your meridian. At that instant any vertical object's shadow lies on the true
  north–south line. No instrument at all. Which way the shadow points is read
  off the computed Sun position rather than assumed from hemisphere, because
  inside the tropics the Sun passes north of the zenith for part of the year and
  the shadow flips with it.
- A magnetic compass, with the declination already worked out for you.

Solar-noon time is shown in your device's timezone and labelled with it, since
that is the useful clock when you are standing at the coordinates.

Running it as a website
-----------------------

It is a plain static site — no build step, no server-side anything — so it can
be dropped on any static host, and you can type your position in by hand instead
of using GPS.

One requirement: serve it over HTTPS. Geolocation, the device-orientation
compass, and the service worker that makes it work offline are all
secure-context APIs. Over plain http:// they fail silently and the GPS button
appears to do nothing. localhost is exempt, which is why npm run serve works.

The one network call
~~~~~~~~~~~~~~~~~~~~

Typing coordinates in by hand leaves altitude to find, so there is a button that
looks it up from Open-Meteo (https://open-meteo.com/) — no key, no account.

It is a button and not an automatic lookup because it is the only request
this app ever makes, and it carries your coordinates to someone else. That
should be a thing you choose, not a thing that happens.

It is also honestly a convenience rather than an accuracy fix: altitude shifts
magnetic declination by under 0.01° even at 3000 m, against a good polar
alignment of about 0.1°. Leaving it at sea level costs you nothing. The reason
it is worth having is that nobody should have to go and look up their own
elevation and type it in.

Deploying
~~~~~~~~~

The service worker uses network-first for the app shell and cache-first only
for the bundled star and magnetic data. Cache-first for everything is how a
static site pins every returning visitor to the first build they ever loaded, so
a deploy would reach nobody until they cleared site data. Bump VERSION in
sw.js with each release so old caches are dropped on activate.

Accessibility
-------------

This is the point of the project, not a later pass.

- Single taps only. No drag, no pinch, no double-tap, no press-and-hold.
- Targets stay put. Values update in place; nothing reflows under your
  finger, because re-acquiring a moved target is expensive.
- Text scales from 0.8× to 1.8× with two big buttons, and the choice sticks.
- Red night mode, because an app that ruins your dark adaptation is an app
  you can't use twice in one night.
- Reads out loud via the browser's speech synthesis, for when you are at the
  mount and not at the screen.
- Haptic confirmation when you are pointing at Polaris.
- Every graphic has a text equivalent. The numbers are the interface; the
  reticle and chart are support. Nothing requires reading a picture.
- Manual position entry for when GPS won't play, and fields keep their
  values when an entry is rejected.

Accuracy, and how it is checked
-------------------------------

Astronomy code is easy to get subtly, confidently wrong, so the two pieces of
real maths are validated against published sources rather than against
themselves. npm test runs both.

- Magnetic declination is a degree-12 spherical harmonic synthesis of
  WMM2025, checked against all 100 of NOAA's own published test values. It
  agrees to better than 0.01° in declination and 1 nT per component.
- Polaris' position is proper motion plus IAU-1976 precession on a
  Hipparcos J2000 position. Sidereal time is anchored to the textbook GMST at
  J2000. Against the worked example published in iOptron's own SkyTracker Pro
  manual, the radius agrees to 0.3′ and the dial position to about 2.4°
  — roughly 1.6′ of alignment error.

  That last residual is not yet explained. It is most likely that the manual's
  figure was read off a screenshot taken a few minutes from the timestamp it
  quotes (2.4° is 9.5 minutes of clock), or that iOptron apply a refraction
  correction we don't. **Cross-check against Stellarium before trusting the dial
  position to better than a few arcminutes.**

Two traps are locked down by tests because both produce output that still looks
correct:

- The AccuAlign reticle is a 12-hour dial spanning a full circle, so one
  dial hour is 30°, not 15°. Mapping hour-angle hours straight onto dial hours
  is a silent factor-of-two error. (It is also why iOptron tell Takahashi users
  to halve their 24-hour reading.)
- The sky chart is drawn facing north, so west is on the left. A mirrored or
  180°-rotated chart still looks like a star chart and will send you
  star-hopping the wrong way.

Which mounts this helps
-----------------------

It computes numbers, so it helps with any polar-aligned mount. It is written
against the iOptron AccuAlign reticle specifically.

Worth knowing if you own an iOptron tracker: the SkyTracker and **SkyTracker
Pro** have no data port at all — the micro-USB is charge-only, and their manual
lists only a power switch, a rate switch and a N/S switch. No app can control
them. The SkyGuider Pro adds an ST-4 guide port and an HBX hand-controller
port; the SkyHunter speaks iOptron's V3 protocol over WiFi and can be driven
properly. This app deliberately does the part that works for all of them.

Running it
----------

    npm test          # validate the maths
    npm run serve     # http://localhost:8790

To regenerate the bundled data from its public sources:

    bash scripts/fetch-sources.sh && npm run build-data

The app is a plain PWA — no build step, no framework, no dependencies. It works
offline once loaded, which is the normal case in a dark field.

Documentation
-------------

- docs/accuracy.md — what is validated against what, the
  three WMM bugs NOAA's test vectors caught, the two traps that produce
  correct-looking output, and the one residual that is still unexplained.
- docs/accessibility.md — the input model, why night
  mode is red, why the compass is optional, and the known gaps.
- docs/deploying.md — the two-phase certificate dance, the
  .json whitelist trap, and why siteDir is site and not the repo root.

Every .md here has a generated .txt twin, kept in sync by
npm run docs:twins and enforced by the test suite.

Data and licence
----------------

MIT. Bundled data is public domain: the Yale Bright Star Catalog (CDS VizieR
V/50, 9,096 stars) and NOAA's World Magnetic Model 2025, valid through 2030.
See LICENSE.
