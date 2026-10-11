// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// EVERY FILE CARRIES THE evomedia.net HEADER.
//
// "make sure each file gets the evomedia tag and the dev@evomedia.net header".
// The same three lines the rest of the fleet opens its files with: the
// project and where its source lives, who made it and how to reach him, and
// the licence. Every file that can hold a comment gets them, generated files
// included, so the generators write them too.
//
// The data files are the one variation. Their numbers come from other people's
// catalogues (NOAA, SIMBAD, IANA, James Hedberg's figures), so they must not
// claim to be MIT; their third line points at the source and terms instead.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const L1 = 'evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris';
const L2 = 'Created by Kelly Michels · dev@evomedia.net';
const L3 = 'Licensed under the MIT License. See LICENSE.';
const L3_DATA = "The code is MIT-licensed (see LICENSE). The data's source and terms are named below and in README.md.";
const DATA = new Set(['site/src/data/wmm2025.js', 'site/src/data/figures.js',
  'site/src/data/galaxies.js', 'site/src/data/southern-zones.js',
  'site/src/data/galaxy-art.js']);
// Not ours to annotate: reference data kept byte for byte as published, and
// the release packages.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'releases', join('test', 'fixtures')]);

function kind(name) {
  if (/\.(m?js)$/.test(name)) return 'code';
  if (/\.(py|sh|ya?ml|css|html|svg)$/.test(name)) return 'code';
  if (name === '.gitignore' || name === '.gitattributes') return 'code';
  return null;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(relative(ROOT, p))) walk(p, out);
    } else if (kind(e.name)) {
      out.push(relative(ROOT, p).split(sep).join('/'));
    }
  }
  return out;
}

const files = walk(ROOT);

test('there are files to check', () => {
  assert.ok(files.length > 100, `only ${files.length} files found under ${ROOT}`);
});

test('every code and config file opens with the evomedia.net header', () => {
  const missing = [];
  for (const rel of files) {
    // The header follows a shebang or a doctype, which have to stay first.
    const head = readFileSync(join(ROOT, rel), 'utf8').split('\n').slice(0, 5).join('\n');
    const third = DATA.has(rel) ? L3_DATA : L3;
    if (!head.includes(L1) || !head.includes(L2) || !head.includes(third)) missing.push(rel);
  }
  assert.deepEqual(missing, [], 'these files lack the header; copy its three lines from any other file');
});

test('the data files do not claim their catalogues are MIT', () => {
  for (const rel of DATA) {
    const head = readFileSync(join(ROOT, rel), 'utf8').split('\n').slice(0, 5).join('\n');
    assert.ok(!head.includes(L3), `${rel} says the whole file is MIT; its data is someone else's`);
  }
});
