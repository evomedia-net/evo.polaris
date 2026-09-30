/**
 * Read or bump this project's version stamp.
 *
 * Scheme: v{major}.{rc}.{beta}.{alpha}.{build} -- priority left to right.
 * Bumping a stage zeroes every lower segment, build included. Within a stage
 * only the build counter moves in normal work; the stage written into the
 * stamp is read off the numbers (see stageOf), never typed.
 *
 *   node scripts/bump-version.mjs get
 *   node scripts/bump-version.mjs bump                 # build + 1, or the
 *                                                      # version zbump asks for
 *   node scripts/bump-version.mjs bump-stage <stage>   # release|rc|beta|alpha
 *   node scripts/bump-version.mjs tag-command
 *
 * THE BUILD COUNTER ADVANCES ONCE PER RELEASE, not per merged PR. A release
 * carrying five PRs moves it by one, because the number names a thing that
 * SHIPPED. It is stamped on the default branch after the merge, never inside a
 * feature PR, so concurrent PRs cannot conflict on it.
 *
 * WHY THIS WRITES THREE FILES. The stamp has to be in three places and they
 * have to agree, so one command writes all three and a test refuses to let
 * them drift:
 *
 *   build-version.json       the source of truth; what zdeploy packs against
 *   site/build-version.json  the SERVED copy -- only site/ is deployed, so a
 *                            stamp outside it is a stamp nobody can check
 *   site/src/version.js      what the app itself shows, as a module, so the
 *                            footer needs no fetch and is right offline
 *
 * That third file is why the version was wrong for this project's whole life:
 * the footer carried a hand-typed "v0.0.0.1.0" that no bump could ever reach.
 *
 * WHY `bump` TAKES ITS ANSWER FROM ZBUMP WHEN THERE IS ONE. zbump owns the
 * release: it decides the next version, then runs this script to write it,
 * then refuses to tag if the two disagree. It runs `bump` whatever kind of
 * release it is cutting, so a bumper that only knew "build + 1" could never
 * make a stage change -- `zbump beta` would work out v0.0.1.0.0, this would
 * write v0.0.0.1.37, and the release would stop at the mismatch. zbump now
 * says which version it wants in ZBUMP_VERSION; this writes exactly that, and
 * refuses one that does not move forward.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'build-version.json');
const SERVED = join(ROOT, 'site', 'build-version.json');
const MODULE = join(ROOT, 'site', 'src', 'version.js');

const STAGES = ['major', 'rc', 'beta', 'alpha', 'build'];

export function parse(version) {
  const parts = String(version).replace(/^v/, '').split('.').map(Number);
  if (parts.length !== 5 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`not a 5-segment version: ${version}`);
  }
  return Object.fromEntries(STAGES.map((k, i) => [k, parts[i]]));
}

export const label = (v) => `v${STAGES.map((k) => v[k]).join('.')}`;

/** Bumping a stage zeroes every lower one. Release is major + 1. */
export function bumpStage(v, stage) {
  const i = stage === 'release' ? 0 : STAGES.indexOf(stage);
  if (i < 0) throw new Error(`unknown stage: ${stage}`);
  const out = { ...v };
  out[STAGES[i]] += 1;
  for (let j = i + 1; j < STAGES.length; j++) out[STAGES[j]] = 0;
  return out;
}

/**
 * The stage a version is IN, read off its numbers: the highest of rc, beta
 * and alpha that is set, or "released" when none is and major is.
 *
 * Read rather than carried, because a stage field that is copied forward is
 * one that can disagree with the number beside it -- and the stamp is what
 * production serves as its answer to "what is this".
 */
export function stageOf(v) {
  if (v.rc > 0) return 'rc';
  if (v.beta > 0) return 'beta';
  if (v.alpha > 0) return 'alpha';
  if (v.major > 0) return 'released';
  throw new Error(`${label(v)} is in no stage -- every segment above build is 0`);
}

/** -1, 0 or 1, by the scheme's priority: major first, build last. */
export function compare(a, b) {
  for (const k of STAGES) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

/**
 * What `bump` writes: the version zbump asked for, or build + 1 without it.
 * A requested version has to be ahead of the current one -- writing an equal
 * or older number would name a release that already happened.
 */
export function nextVersion(current, requested) {
  if (!requested) return bumpStage(current, 'build');
  const want = parse(requested);
  if (compare(want, current) <= 0) {
    throw new Error(`asked for ${label(want)}, which is not ahead of ${label(current)}`);
  }
  return want;
}

function read() {
  return parse(JSON.parse(readFileSync(SOURCE, 'utf8')).version);
}

function write(v) {
  const version = label(v).slice(1);
  const doc = {
    version,
    stage: stageOf(v),
    scheme: 'v{major}.{rc}.{beta}.{alpha}.{build}',
    note: 'Build advances once per release on the default branch, never inside a PR.',
  };
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(SOURCE, json);
  // The served copy is byte-identical: zdeploy compares the label it packed
  // against the one the site hands back, and two files that could differ is
  // two files that eventually will.
  writeFileSync(SERVED, json);
  writeFileSync(MODULE,
    '// GENERATED by scripts/bump-version.mjs -- do not edit by hand.\n'
    + '//\n'
    + '// The app shows its own version from here rather than fetching the\n'
    + '// JSON, so the footer is right with the radio off like everything else.\n'
    + `export const VERSION = '${label(v)}';\n`);
  return label(v);
}

// Running it acts; importing it (as the tests do) does not.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, arg] = process.argv.slice(2);
  const current = read();

  if (cmd === 'get') {
    process.stdout.write(`${label(current)}\n`);
  } else if (cmd === 'bump') {
    process.stdout.write(`${write(nextVersion(current, process.env.ZBUMP_VERSION))}\n`);
  } else if (cmd === 'bump-stage') {
    process.stdout.write(`${write(bumpStage(current, arg))}\n`);
  } else if (cmd === 'tag-command') {
    const l = label(current);
    process.stdout.write(`git tag -a ${l} -m "${l}" && git push --follow-tags\n`);
  } else if (cmd) {
    process.stderr.write('usage: get | bump | bump-stage <stage> | tag-command\n');
    process.exit(1);
  }
}
