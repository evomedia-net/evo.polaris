import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GALAXIES, GALAXY_KEYS, galaxyFor } from '../site/src/data/galaxies.js';

// THE FIFTEEN BRIGHTEST GALAXIES, CHECKED AGAINST THE QUERY THEY CAME FROM.
//
// Nothing in this app is validated against itself, and a galaxy is the same
// kind of claim as a magnetic declination: a number somebody else published,
// which this app either copied correctly or did not. So the SIMBAD answer is
// committed at test/fixtures/simbad-galaxies.txt and this file compares the
// shipped module to it, field by field. A coordinate typed wrong is a test
// failure rather than an arrow pointing at empty sky.
//
// The fixture also names the six brighter objects that were deliberately left
// out and why. That is a judgement rather than a measurement, so it is
// written down where it can be argued with rather than buried.

const root = new URL('../', import.meta.url);
const fixture = readFileSync(
  fileURLToPath(new URL('test/fixtures/simbad-galaxies.txt', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('site/src/app.js', root)), 'utf8');
const skydraw = readFileSync(fileURLToPath(new URL('site/src/skydraw.js', root)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('site/index.html', root)), 'utf8');
const sw = readFileSync(fileURLToPath(new URL('site/sw.js', root)), 'utf8');

/** The fixture's data rows, as the service returned them. */
function published() {
  const rows = [];
  for (const line of fixture.split(/\r?\n/)) {
    const parts = line.split('|');
    if (parts.length !== 6) continue;
    if (parts[0] === 'main_id') continue;          // the header
    const [id, ra, dec, v, maj, min] = parts;
    rows.push({ id: id.replace(/\s+/g, ' ').trim(),
      ra: Number(ra), dec: Number(dec), mag: Number(v),
      maj: Number(maj), min: Number(min) });
  }
  return rows;
}

test('the fixture is the real answer, not a stub', () => {
  const rows = published();
  assert.equal(rows.length, 15, `fifteen rows, found ${rows.length}`);
  for (const r of rows) {
    assert.ok(Number.isFinite(r.ra) && Number.isFinite(r.dec));
    assert.ok(Number.isFinite(r.mag) && Number.isFinite(r.maj) && Number.isFinite(r.min));
  }
  // And it says where it came from, so the numbers can be re-fetched.
  assert.match(fixture, /simbad\.u-strasbg\.fr/);
  assert.match(fixture, /SELECT main_id, ra, dec, V/);
});

test('every shipped galaxy matches the published row, to the digit', () => {
  const rows = published();
  assert.equal(GALAXIES.length, rows.length);
  for (const r of rows) {
    // SIMBAD writes "M  31" and "NGC    55"; the module carries the tidy form.
    const want = r.id.replace(/^NAME /, '');
    const got = GALAXIES.find((g) => g.id === want
      || g.name === want
      || (want === 'LMC' && g.key === 'lmc')
      || (want === 'SMC' && g.key === 'smc')
      || (want === 'Centaurus A' && g.name === 'Centaurus A'));
    assert.ok(got, `nothing shipped for ${r.id}`);
    assert.equal(got.ra, r.ra, `${want} right ascension`);
    assert.equal(got.dec, r.dec, `${want} declination`);
    assert.equal(got.mag, r.mag, `${want} magnitude`);
    assert.equal(got.maj, r.maj, `${want} major axis`);
    assert.equal(got.min, r.min, `${want} minor axis`);
  }
});

test('brightest first, which is the order the button walks', () => {
  for (let i = 1; i < GALAXIES.length; i++) {
    assert.ok(GALAXIES[i].mag >= GALAXIES[i - 1].mag,
      `${GALAXIES[i].name} at ${GALAXIES[i].mag} follows ${GALAXIES[i - 1].mag}`);
  }
  assert.equal(GALAXIES[0].name, 'Large Magellanic Cloud');
  assert.equal(GALAXY_KEYS[0], 'lmc');
  assert.deepEqual(GALAXY_KEYS, GALAXIES.map((g) => g.key));
});

test('the numbers are all in range, and every key is its own', () => {
  const keys = new Set();
  for (const g of GALAXIES) {
    assert.ok(g.ra >= 0 && g.ra < 360, `${g.name} ra ${g.ra}`);
    assert.ok(g.dec >= -90 && g.dec <= 90, `${g.name} dec ${g.dec}`);
    assert.ok(g.maj >= g.min, `${g.name}: a major axis below its minor`);
    assert.ok(g.name && g.id && g.key, `${JSON.stringify(g)} is missing a name`);
    assert.ok(!keys.has(g.key), `two galaxies share the key ${g.key}`);
    keys.add(g.key);
    assert.equal(galaxyFor(g.key), g);
  }
  assert.equal(galaxyFor('nope'), undefined);
});

test('the exclusions are written down with their reasons', () => {
  // A judgement buried is a judgement nobody can argue with. Each of the six
  // brighter objects that did not ship is named in the fixture with why.
  for (const left of ['CMa Dwarf', 'SDG', 'Z 75-118', 'MCG-06-07-001',
                      'AM 0311-513', 'Sculptor Dwarf']) {
    assert.ok(fixture.includes(left), `${left} is excluded and unexplained`);
  }
  assert.match(fixture, /dwarf spheroidal/i);
  // And the Magellanic Clouds, which are the same shape of object and stay,
  // have their own line saying why.
  assert.match(fixture, /Magellanic Clouds\s+are the opposite case/);
});

// --- how the app uses them -------------------------------------------------

test('they are placed like the stars, precessed and all', () => {
  // J2000 catalogue positions. Precessing the stars and not these would put
  // them 22 arcminutes from the star field they sit in -- the exact bug the
  // frames audit found, in one object instead of all of them.
  const block = appJs.slice(appJs.indexOf('skyGalaxies = GALAXIES.map'),
    appJs.indexOf('milkyWay = buildMilkyWay'));
  assert.match(block, /equatorialToVector\(g\.ra, g\.dec, lst, site\.lat, precess\)/);
});

test('one button walks them, brightest first, then lets go', () => {
  const h = appJs.slice(appJs.indexOf("$('tgtGalaxies').onclick"),
    appJs.indexOf('function applyGalaxiesLabel'));
  assert.match(h, /galaxyStep = nextStop\(galaxyStep, GALAXY_KEYS\.length,/);
  assert.match(h, /\(i\) => !skyUpOnly \|\| stopIsUp\(GALAXY_TARGETS\[i\]\)\);/,
    'and it skips what is down, like the other two walks');
  assert.match(h, /: 'none';/, 'past the last one the ring is cleared');
  assert.match(h, /goToTarget\(next, \{ keepCycle: true \}\)/);
  // The three walks must not tangle.
  assert.match(h, /planetStep = -1;/);
  assert.match(h, /constStep = -1;/);
  assert.match(appJs, /if \(!keepCycle\) \{ planetStep = -1; constStep = -1; galaxyStep = -1; \}/);
});

test('a galaxy under the ground says so rather than ringing nothing', () => {
  const painted = appJs.slice(appJs.indexOf('function targetIsPainted('),
    appJs.indexOf('function targetIsBelow('));
  assert.match(painted, /if \(what\.startsWith\('gal:'\)\) return t\.alt > 0;/);
  // Which is what makes "never rises from here" reachable for these -- from
  // a northern latitude several of them never do.
  assert.match(appJs, /No galaxy is above the horizon right now\./);
});

test('they are drawn at their true size, not as dots', () => {
  const block = skydraw.slice(skydraw.indexOf('if (o.galaxies) {'),
    skydraw.indexOf('// STARS, IN THREE PASSES.'));
  // The arcminute axes through the same focal length as everything else.
  assert.match(block, /Math\.tan\(\(g\.maj \/ 120\) \* Math\.PI \/ 180\) \* focal/);
  assert.match(block, /Math\.tan\(\(g\.min \/ 120\) \* Math\.PI \/ 180\) \* focal/);
  assert.match(block, /ctx\.ellipse\(/);
  assert.match(block, /ctx\.stroke\(\);/, 'an outline, not a fill');
  assert.ok(!/ctx\.fill\(\);/.test(block),
    'a filled blob would claim a brightness these do not have');
  // Before the stars: every star in the frame is nearer than any of these.
  assert.ok(skydraw.indexOf('if (o.galaxies) {') < skydraw.indexOf('// STARS, IN THREE PASSES.'));
  // Red at night, like everything else.
  assert.match(block, /night \? '#8b0000'/);
});

test('the switch, the button and the file all exist', () => {
  assert.match(html, /id="tgtGalaxies"[^>]*aria-label="Point at the next galaxy, brightest first">Galaxies</);
  assert.match(html, /id="skyGalaxies" class="big-btn">Hide the galaxies</);
  assert.match(appJs, /let skyShowGalaxies = store\.get\('galaxies', true\);/);
  assert.match(appJs, /galaxies: skyShowGalaxies \? skyGalaxies : null,/);
  assert.match(sw, /'\.\/src\/data\/galaxies\.js'/, 'cached for offline use');
});
