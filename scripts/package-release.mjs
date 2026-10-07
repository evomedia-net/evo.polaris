// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// PACKAGE A RELEASE: THE APP AS DEPLOYED, IN ONE ZIP, IN releases/.
//
//     node scripts/package-release.mjs            # the version in build-version.json
//
// scripts/bump-version.mjs calls this after every stamp, so a release commit
// carries its own package: zbump runs the bumper, then commits everything the
// bumper wrote. Nothing has to remember to do it.
//
// WHAT IS IN IT. site/ -- the whole PWA, byte for byte what zdeploy puts on
// the server, and all anyone needs to run it: there is no build step -- plus
// LICENSE, the README and its plain-text twin, and CHECKSUMS.txt. Everything
// sits under one folder named for the version, so unzipping two releases side
// by side cannot mix them.
//
// CHECKSUMS.txt IS INSIDE, and a .sha256 of the zip sits beside it. Checking
// the .sha256 proves the zip; the manifest inside then proves each file, so a
// copy that has been unzipped and passed around can still be checked.
//
// IT IS REPRODUCIBLE. Entries are sorted, every timestamp is the zip format's
// earliest (1980-01-01), and nothing about the machine or the moment goes in,
// so the same tree packs to the same bytes and the .sha256 means something.
//
// No dependencies: zlib has deflate and a CRC-32, and the rest of the zip
// format is a few fixed-layout headers.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const NAME = 'evo.polaris';
/** Beside site/: the licence and the readme a stranger needs first. */
const EXTRAS = ['LICENSE', 'README.md', 'README.txt'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every file under dir, as forward-slash paths relative to root. Dotfiles are skipped. */
function walk(dir, root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** The files a release carries, relative to the repo root, sorted. */
export function releaseFiles(root) {
  const files = walk(join(root, 'site'), root);
  for (const f of EXTRAS) if (existsSync(join(root, f))) files.push(f);
  return files.sort();
}

/** "0.0.1.0.37" -> the folder and zip name it is packed under. */
export const packageName = (version) => `${NAME}-v${String(version).replace(/^v/, '')}`;

/**
 * A zip of the given entries. Deterministic: same entries, same bytes.
 * @param {{name: string, data: Buffer}[]} entries  in the order to write them
 */
export function zip(entries) {
  const DOS_TIME = 0;                          // 00:00:00
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;    // 1980-01-01
  const UTF8 = 0x0800;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // Stored when deflate would not help: PNGs and WebPs are compressed already.
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                // version needed: 2.0
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);                // no extra field
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);              // made by: 2.0, MS-DOS attributes
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra, comment, disk, internal and external attributes: all zero
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Write releases/<name>.zip and releases/<name>.zip.sha256 for this version.
 * @returns {{zipPath: string, digest: string, files: number}}
 */
export function packageRelease({ root, version }) {
  const base = packageName(version);
  const files = releaseFiles(root);
  const entries = files.map((f) => ({ name: `${base}/${f}`, data: readFileSync(join(root, f)) }));
  const checksums = entries
    .map((e) => `${sha256(e.data)}  ${e.name.slice(base.length + 1)}`)
    .join('\n') + '\n';
  entries.push({ name: `${base}/CHECKSUMS.txt`, data: Buffer.from(checksums, 'utf8') });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const out = zip(entries);
  const dir = join(root, 'releases');
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, `${base}.zip`);
  writeFileSync(zipPath, out);
  const digest = sha256(out);
  writeFileSync(`${zipPath}.sha256`, `${digest}  ${base}.zip\n`);
  return { zipPath, digest, files: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { version } = JSON.parse(readFileSync(join(root, 'build-version.json'), 'utf8'));
  const { zipPath, digest, files } = packageRelease({ root, version });
  process.stdout.write(`${relative(root, zipPath)}  ${files} files  sha256 ${digest}\n`);
}
