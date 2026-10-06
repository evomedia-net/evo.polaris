// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// RECORD WHAT THE CACHE KEY IN sw.js IS A KEY FOR.
//
// The service worker names its cache from VERSION, and a returning visitor
// only sees a changed file once that name changes. Nothing enforced that:
// edit a precached file, forget the bump, and the deploy ships and is inert
// for everyone who has been here before. It fails silently and it fails only
// for returning visitors, which is the worst shape a bug can have.
//
// So the digest of every precached file is written down beside the version it
// was taken at, and test/precache-version.test.mjs fails when the two stop
// agreeing. This script is what makes them agree again:
//
//     npm run precache-stamp
//
// Run it AFTER bumping VERSION in site/sw.js, in the same commit as the change
// it is describing.
//
// THE RELEASE STAMP IS DELIBERATELY NOT COVERED: build-version.json and
// src/version.js, the two files under site/ that scripts/bump-version.mjs
// writes. They are rewritten by the release rather than by a change, and
// holding the cache key to them would demand a bump for a file nobody
// edited. Covering version.js turned main red after every release: the
// release commit moved the footer's number, the guard read that as an
// unannounced change, and the suite stayed red until the next feature PR
// happened to restamp. Both are shell files, fetched network-first and
// re-cached on every online load, so a stale copy of either lives no longer
// than one visit with the radio on.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const swPath = fileURLToPath(new URL('site/sw.js', root));
export const STAMP = fileURLToPath(new URL('test/fixtures/precache.json', root));

/** Paths the worker precaches that the stamp does not cover, and why. */
export const SKIP = new Set([
  './',                       // the same bytes as ./index.html
  './build-version.json',     // the release stamp, not part of the change
  './src/version.js',         // the same stamp, as the footer's module
]);

/** The cache key the worker is using now. */
export function versionIn(sw) {
  const m = sw.match(/^const VERSION = '([^']+)';$/m);
  if (!m) throw new Error('site/sw.js has no VERSION line');
  return m[1];
}

/** Every path in the worker's ASSETS list, in the order it lists them. */
export function assetsIn(sw) {
  const block = sw.slice(sw.indexOf('const ASSETS = ['), sw.indexOf('];', sw.indexOf('const ASSETS = [')));
  const found = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!found.length) throw new Error('site/sw.js has no ASSETS entries');
  return found;
}

/**
 * A digest per precached file, read from disk.
 *
 * Hashed as BYTES, not as text: a file that changed only its line endings has
 * changed for the browser, and normalising here would hide exactly the kind
 * of difference that makes a cached copy stale.
 */
export function digestsFor(sw, siteDir) {
  const out = {};
  for (const rel of assetsIn(sw)) {
    if (SKIP.has(rel)) continue;
    const path = fileURLToPath(new URL(rel.replace('./', ''), siteDir));
    out[rel] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  }
  return out;
}

export function readStamp() {
  return JSON.parse(readFileSync(STAMP, 'utf8'));
}

export function currentStamp() {
  const sw = readFileSync(swPath, 'utf8');
  return { version: versionIn(sw), files: digestsFor(sw, new URL('site/', root)) };
}

// Running it writes the stamp; importing it does not.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = currentStamp();
  writeFileSync(STAMP, `${JSON.stringify(now, null, 2)}\n`);
  const n = Object.keys(now.files).length;
  console.log(`stamped ${n} precached files at ${now.version}`);
}
