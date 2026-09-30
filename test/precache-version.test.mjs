import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assetsIn, versionIn, currentStamp, readStamp, SKIP,
} from '../scripts/precache-stamp.mjs';

// A CHANGED FILE THAT SHIPS AND DOES NOTHING.
//
// The worker names its cache from VERSION, and a returning visitor only sees
// a changed file once that name changes. Nothing enforced the bump: edit a
// precached file, forget it, and the deploy reaches everyone who has never
// been here and NOBODY who has. It fails silently, and only for the people
// who use the app most.
//
// The failure mode is already on the record twice in sw.js's own comments --
// an index.html carrying a claim that had been corrected, and an og-card
// that needed its URL changed before a scraper would look again -- so this is
// a mistake the project has made and written down rather than a hypothetical.
//
// The rule is one line: the stamp must match the version AND the files. One
// command makes both true again:
//
//     npm run precache-stamp
//
// Run it after bumping VERSION, in the same commit as the change.

const root = new URL('../', import.meta.url);
const sw = readFileSync(fileURLToPath(new URL('site/sw.js', root)), 'utf8');

test('the cache key has moved since the last stamp, if anything precached changed', () => {
  const now = currentStamp();
  const was = readStamp();
  const changed = Object.keys(now.files)
    .filter((f) => now.files[f] !== was.files[f]);
  const gone = Object.keys(was.files).filter((f) => !(f in now.files));

  if (!changed.length && !gone.length) {
    // Nothing moved, so the version must not have either -- otherwise the
    // stamp is stale and the NEXT edit would slip through against an old
    // digest with no way to tell.
    assert.equal(now.version, was.version,
      `site/sw.js is at ${now.version} and the stamp is at ${was.version}. `
      + 'Run `npm run precache-stamp`.');
    return;
  }

  const what = [...changed, ...gone.map((f) => `${f} (no longer precached)`)];
  assert.notEqual(now.version, was.version,
    `${what.length} precached file(s) changed since the cache key was stamped `
    + `at ${was.version}:\n  ${what.join('\n  ')}\n`
    + 'A returning visitor is served the OLD copy until VERSION changes. '
    + 'Bump VERSION in site/sw.js, then run `npm run precache-stamp`.');
  // Bumped but not stamped is also wrong: it leaves the digests describing a
  // build nobody is running.
  assert.fail(
    `VERSION moved to ${now.version} and the stamp is still at ${was.version}. `
    + 'Run `npm run precache-stamp` to record what this key is a key for.');
});

test('the stamp covers every precached file, and only real ones', () => {
  const listed = assetsIn(sw);
  const stamped = Object.keys(readStamp().files);
  // The skipped few are listed once, in the script, with a reason each;
  // everything else in the worker's list must be covered, or a file could
  // change unwatched.
  const expected = listed.filter((f) => !SKIP.has(f));
  assert.ok(SKIP.size <= 3, `${SKIP.size} precached files are unwatched -- each needs a reason`);
  assert.deepEqual(stamped.sort(), expected.sort());
  assert.ok(stamped.length > 30, `only ${stamped.length} files stamped`);
});

test('a release on its own never turns the suite red', () => {
  // The release commit rewrites the stamp and nothing else. Every file it
  // writes under site/ must therefore be one the guard does not watch --
  // otherwise a build bump reads as a change that forgot its cache key, and
  // main is red from the release until the next feature PR restamps. That
  // was the state after v0.0.0.1.36: src/version.js was watched, and the
  // release moved it.
  const bumper = readFileSync(fileURLToPath(new URL('scripts/bump-version.mjs', root)), 'utf8');
  const written = [...bumper.matchAll(/join\(ROOT, 'site', ([^)]+)\)/g)]
    .map((m) => `./${[...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]).join('/')}`);
  assert.deepEqual(written.sort(), ['./build-version.json', './src/version.js'],
    'the bumper writes a different set of site/ files than this test knows about');
  for (const f of written) {
    assert.ok(SKIP.has(f), `${f} is written by every release and watched by the guard`);
  }
});

test('every precached file is actually there', () => {
  // A path in the list that does not exist makes the worker's install reject,
  // and an install that rejects means NO offline copy at all -- the app
  // silently stops working in a dark field, which is the one place it must.
  for (const rel of assetsIn(sw)) {
    if (rel === './') continue;
    const path = fileURLToPath(new URL(`site/${rel.replace('./', '')}`, root));
    assert.doesNotThrow(() => readFileSync(path), `${rel} is precached and missing`);
  }
});

test('the version is a five-segment build number', () => {
  assert.match(versionIn(sw), /^\d+\.\d+\.\d+\.\d+\.\d+$/);
});
