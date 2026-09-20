import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, label, bumpStage } from '../scripts/bump-version.mjs';

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

test('this project is alpha, and says so', () => {
  const source = JSON.parse(read('build-version.json'));
  assert.equal(source.stage, 'alpha');
  const v = parse(source.version);
  assert.equal(v.major, 0, 'alpha means major 0');
  assert.equal(v.alpha, 1, 'the alpha segment carries the stage');
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
