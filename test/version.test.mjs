import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parse, label, bumpStage, stageOf, compare, nextVersion,
} from '../scripts/bump-version.mjs';

// THE VERSION HAS TO BE IN THREE PLACES AND THEY HAVE TO AGREE.
//
// It was in one place and wrong in another for this project's whole life: the
// footer carried a hand-typed "v0.0.0.1.0" that no bump could reach, the stamp
// lived outside site/ so it was never deployed, and production answered 404 to
// anyone asking what build was running. A stamp nobody can read is not a
// stamp, and a check that cannot fail is worse than no check.

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

test('the source, the served copy and the module all say the same version', () => {
  const source = JSON.parse(read('build-version.json'));
  const served = JSON.parse(read('site/build-version.json'));
  assert.equal(served.version, source.version,
    'site/build-version.json is what production serves — it must match the source');
  const module = read('site/src/version.js');
  const inModule = module.match(/VERSION = '(v[0-9.]+)'/);
  assert.ok(inModule, 'site/src/version.js must export a VERSION');
  assert.equal(inModule[1], `v${source.version}`,
    'the version the app displays must match the one it was stamped with');
});

test('the served stamp is inside the only directory that gets deployed', () => {
  // zdeploy ships site/ and nothing else. A stamp in the repo root is a stamp
  // that never leaves the laptop, which is exactly how this went unnoticed.
  assert.doesNotThrow(() => read('site/build-version.json'));
  // And the app must ship it, or a cold offline load has no version at all.
  assert.match(read('site/sw.js'), /build-version\.json/,
    'the service worker must precache the served stamp');
});

test('the app shows the stamp rather than a typed-in string', () => {
  const app = read('site/src/app.js');
  assert.match(app, /import \{ VERSION \}/, 'app.js must import the version');
  assert.ok(!/v\d+\.\d+\.\d+\.\d+\.\d+/.test(app),
    'app.js still contains a hand-typed version literal');
});

test('the stage it names is the stage its numbers say', () => {
  // This used to assert "alpha" outright, which is a test that the stage
  // switch itself would have failed. What must hold at every stage is that
  // the word and the number agree: production serves both, and a stamp
  // reading "alpha" beside v0.0.1.0.0 is a stamp that cannot be believed.
  const source = JSON.parse(read('build-version.json'));
  assert.equal(source.stage, stageOf(parse(source.version)),
    `build-version.json says ${source.stage} at v${source.version}`);
  assert.equal(JSON.parse(read('site/build-version.json')).stage, source.stage);
});

// --- the scheme itself ------------------------------------------------------

test('bumping a stage zeroes every lower segment, build included', () => {
  const v = parse('0.0.0.1.7');
  assert.equal(label(bumpStage(v, 'build')), 'v0.0.0.1.8');
  assert.equal(label(bumpStage(v, 'alpha')), 'v0.0.0.2.0');
  assert.equal(label(bumpStage(v, 'beta')), 'v0.0.1.0.0');
  assert.equal(label(bumpStage(v, 'rc')), 'v0.1.0.0.0');
  assert.equal(label(bumpStage(v, 'release')), 'v1.0.0.0.0');
});

test('a version that is not five segments is refused', () => {
  assert.throws(() => parse('1.0.0'), /5-segment/);
  assert.throws(() => parse('1.0.0.0.x'), /5-segment/);
  assert.doesNotThrow(() => parse('v0.0.0.1.0'));
});

test('the stage is read off the numbers', () => {
  assert.equal(stageOf(parse('0.0.0.1.36')), 'alpha');
  assert.equal(stageOf(parse('0.0.1.0.0')), 'beta');
  assert.equal(stageOf(parse('0.1.0.0.0')), 'rc');
  assert.equal(stageOf(parse('1.0.0.0.70')), 'released');
  // A beta of the next major is still a beta.
  assert.equal(stageOf(parse('1.0.1.0.0')), 'beta');
  assert.throws(() => stageOf(parse('0.0.0.0.5')), /no stage/);
});

test('versions order by the scheme, major first and build last', () => {
  assert.equal(compare(parse('0.0.1.0.0'), parse('0.0.0.1.36')), 1,
    'beta 1 build 0 is ahead of alpha 1 build 36');
  assert.equal(compare(parse('0.0.0.1.36'), parse('0.0.0.1.37')), -1);
  assert.equal(compare(parse('0.0.0.1.36'), parse('v0.0.0.1.36')), 0);
});

test('bump writes the version zbump asks for, and only a forward one', () => {
  const now = parse('0.0.0.1.36');
  assert.equal(label(nextVersion(now, undefined)), 'v0.0.0.1.37', 'no request: build + 1');
  assert.equal(label(nextVersion(now, '')), 'v0.0.0.1.37');
  assert.equal(label(nextVersion(now, 'v0.0.1.0.0')), 'v0.0.1.0.0', 'the beta switch');
  assert.equal(label(nextVersion(now, 'v0.0.0.1.37')), 'v0.0.0.1.37', 'an ordinary release');
  assert.throws(() => nextVersion(now, 'v0.0.0.1.36'), /not ahead/);
  assert.throws(() => nextVersion(now, 'v0.0.0.1.35'), /not ahead/);
  assert.throws(() => nextVersion(now, 'v0.0.1'), /5-segment/);
});

test('the stage switch, run the way zbump will run it', () => {
  // The whole path, not the arithmetic: a copy of the real script in a
  // scratch tree, run as `npm run bump-version` runs it, with ZBUMP_VERSION
  // set the way zbump sets it for `zbump beta`. This is the command the beta
  // release depends on, and it has never been run for real.
  const tmp = mkdtempSync(join(tmpdir(), 'polaris-bump-'));
  try {
    mkdirSync(join(tmp, 'scripts'));
    mkdirSync(join(tmp, 'site', 'src'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('scripts/bump-version.mjs', root)),
      join(tmp, 'scripts', 'bump-version.mjs'));
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(tmp, 'build-version.json'),
      `${JSON.stringify({ version: '0.0.0.1.36', stage: 'alpha' })}\n`);

    const run = (env) => execFileSync(process.execPath,
      [join(tmp, 'scripts', 'bump-version.mjs'), 'bump'],
      { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();

    assert.equal(run({ ZBUMP_VERSION: 'v0.0.1.0.0' }), 'v0.0.1.0.0');
    const source = JSON.parse(readFileSync(join(tmp, 'build-version.json'), 'utf8'));
    assert.equal(source.version, '0.0.1.0.0');
    assert.equal(source.stage, 'beta', 'the stamp names the stage it switched to');
    assert.equal(readFileSync(join(tmp, 'site', 'build-version.json'), 'utf8'),
      readFileSync(join(tmp, 'build-version.json'), 'utf8'));
    assert.match(readFileSync(join(tmp, 'site', 'src', 'version.js'), 'utf8'),
      /export const VERSION = 'v0\.0\.1\.0\.0';/);

    // And the first ordinary release after it is beta build 1.
    assert.equal(run({ ZBUMP_VERSION: '' }), 'v0.0.1.0.1');
    // A repeat of a version already written is refused, not rewritten.
    assert.throws(() => run({ ZBUMP_VERSION: 'v0.0.1.0.1' }), /not ahead/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
