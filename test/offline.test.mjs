// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// The service-worker precache list is a hand-kept copy of what the app loads,
// and it had already drifted twice: guide.js, words.js, skyview.js, skydraw.js,
// coords.js and briefing.js were all shipped without being listed.
//
// Nothing breaks in the browser when that happens -- online, the network
// serves them and everything looks fine. It only shows up offline, in a field,
// at night, which is the one situation this app exists for and the one place
// nobody is going to notice a missing file in a dev tools panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(ROOT, 'site', 'sw.js'), 'utf8');
const listed = new Set(
  [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]),
);

test('every module the app ships is precached for offline use', () => {
  const modules = readdirSync(join(ROOT, 'site', 'src'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `src/${f}`);
  assert.ok(modules.length > 5, `expected the app modules, found ${modules.length}`);
  const missing = modules.filter((m) => !listed.has(m));
  assert.deepEqual(missing, [],
    `not in sw.js ASSETS, so the app breaks offline: ${missing.join(', ')}`);
});

test('the data files and the shell are precached too', () => {
  for (const f of ['index.html', 'manifest.webmanifest', 'src/style.css',
                   'src/data/stars.json', 'src/data/wmm2025.js']) {
    assert.ok(listed.has(f), `${f} is not precached`);
  }
});

test('every precached path actually exists', () => {
  // The other direction: a path that was renamed leaves addAll() rejecting,
  // which makes the service worker fail to install at all and silently
  // disables offline support for everyone.
  for (const path of listed) {
    if (path === '' || path.endsWith('/')) continue;
    assert.doesNotThrow(() => readFileSync(join(ROOT, 'site', path)),
      `sw.js precaches ${path}, which does not exist`);
  }
});
