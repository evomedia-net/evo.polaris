// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, crc32 } from 'node:zlib';
import { packageRelease, packageName, releaseFiles, zip } from '../scripts/package-release.mjs';

// EVERY RELEASE CARRIES ITS OWN PACKAGE: THE APP AS DEPLOYED, IN ONE ZIP.
//
// A zip that no tool can open, or that holds a different file than the one
// that shipped, is worse than none -- it is a checksum people will trust.
// So the zip is read back here by a reader that shares nothing with the
// writer, and every entry is compared to the file it came from.

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Read a zip by its central directory, the way unzip tools do. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'no end-of-central-directory record');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(at), 0x04034b50, `${name}: local header`);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.ok(method === 0 || method === 8, `${name}: method ${method}`);
    assert.equal(data.length, size, `${name}: size`);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    out.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

test('the zip format itself round-trips', () => {
  const entries = [
    { name: 'a/empty.txt', data: Buffer.alloc(0) },
    { name: 'a/text.txt', data: Buffer.from('polaris '.repeat(500)) },       // deflates
    { name: 'a/noise.bin', data: createHash('sha512').update('x').digest() }, // stored
    { name: 'a/naïve.txt', data: Buffer.from('utf-8 name') },
  ];
  const got = unzip(zip(entries));
  assert.deepEqual([...got.keys()], entries.map((e) => e.name));
  for (const e of entries) assert.ok(got.get(e.name).equals(e.data), e.name);
});

test('the real release holds the app exactly as deployed', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'polaris-pack-'));
  try {
    // A copy of what the release is made from, so this never writes into
    // the repository's own releases/.
    cpSync(join(root, 'site'), join(tmp, 'site'), { recursive: true });
    for (const f of ['LICENSE', 'README.md', 'README.txt']) cpSync(join(root, f), join(tmp, f));

    const { zipPath, digest, files } = packageRelease({ root: tmp, version: '0.0.1.0.37' });
    assert.equal(zipPath, join(tmp, 'releases', 'evo.polaris-v0.0.1.0.37.zip'));
    const buf = readFileSync(zipPath);
    assert.equal(digest, sha(buf));
    assert.equal(readFileSync(`${zipPath}.sha256`, 'utf8'), `${digest}  evo.polaris-v0.0.1.0.37.zip\n`,
      'the .sha256 is in the format `sha256sum -c` reads');

    const entries = unzip(buf);
    const base = 'evo.polaris-v0.0.1.0.37/';
    for (const name of entries.keys()) assert.ok(name.startsWith(base), `${name} is outside the release folder`);

    // Every file, byte for byte.
    const listed = releaseFiles(tmp);
    assert.equal(files, listed.length);
    assert.ok(listed.includes('site/index.html') && listed.includes('site/sw.js'));
    assert.ok(listed.includes('LICENSE'), 'a release with no licence is not open source');
    for (const f of listed) {
      assert.ok(entries.get(base + f)?.equals(readFileSync(join(tmp, f))), `${f} differs in the zip`);
    }
    assert.equal(entries.size, listed.length + 1, 'something extra is in the zip');

    // And the manifest inside proves each file once the zip is gone.
    const sums = entries.get(`${base}CHECKSUMS.txt`).toString('utf8').trim().split('\n');
    assert.equal(sums.length, listed.length);
    for (const line of sums) {
      const [hex, path] = line.split('  ');
      assert.equal(hex, sha(entries.get(base + path)), `${path}: CHECKSUMS.txt is wrong`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the same tree packs to the same bytes', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'polaris-pack-'));
  try {
    cpSync(join(root, 'site'), join(tmp, 'site'), { recursive: true });
    const a = readFileSync(packageRelease({ root: tmp, version: '0.0.1.0.37' }).zipPath);
    writeFileSync(join(tmp, 'site', 'index.html'), readFileSync(join(tmp, 'site', 'index.html')));
    const b = readFileSync(packageRelease({ root: tmp, version: '0.0.1.0.37' }).zipPath);
    assert.ok(a.equals(b), 'a re-pack of an unchanged tree changed the zip');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('names carry the version, with or without its v', () => {
  assert.equal(packageName('0.0.1.0.37'), 'evo.polaris-v0.0.1.0.37');
  assert.equal(packageName('v0.0.1.0.37'), 'evo.polaris-v0.0.1.0.37');
});

test('the bumper packs every release it stamps', () => {
  const bumper = readFileSync(join(root, 'scripts', 'bump-version.mjs'), 'utf8');
  assert.match(bumper, /import \{ packageRelease \} from '\.\/package-release\.mjs';/);
  assert.match(bumper, /cmd === 'bump'\) \{\s*process\.stdout\.write\(`\$\{stampAndPack\(/);
  assert.match(bumper, /cmd === 'bump-stage'\) \{\s*process\.stdout\.write\(`\$\{stampAndPack\(/);
});
