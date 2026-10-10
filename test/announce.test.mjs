// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nextAnnouncement, REPEAT_MS, REPEAT_DEG } from '../site/src/announce.js';

// A SCREEN READER HEARS EACH THING ONCE, NOT 2.4 TIMES A SECOND (#221).
//
// Measured on the live site: tracking the ISS rewrote the live region 36 times
// in 15 seconds, each time with a forty-word sentence. The rule in announce.js
// decides what is said; these are the cases that matter, driven the way the
// drawing loop drives it.

const iss = (at, az, alt, extra = {}) => ({
  key: 'iss|up|', text: `Tracking the ISS: ${Math.round(az)}° round, ${Math.round(alt)}° up.`,
  az, alt, at, ...extra,
});

/** Run a sequence through the rule and return what was said. */
function said(seq) {
  let prev = null;
  const out = [];
  for (const now of seq) {
    const next = nextAnnouncement(prev, now);
    if (next) { prev = next; out.push(now.text); }
  }
  return out;
}

test('the ISS crossing the sky for fifteen seconds is said once, not 36 times', () => {
  // 2.4 frames a second, the station moving about a degree a second.
  const frames = Array.from({ length: 36 }, (_, i) => iss(i * 417, 81 + i * 0.4, 30 + i * 0.4));
  assert.equal(said(frames).length, 1);
});

test('a moving target is said again only after it has moved AND half a minute has passed', () => {
  const start = iss(0, 100, 30);
  // Far, but too soon.
  assert.deepEqual(said([start, iss(5000, 140, 30)]), [start.text]);
  // Late enough, but it has barely moved.
  assert.deepEqual(said([start, iss(REPEAT_MS + 1, 100 + REPEAT_DEG / 2, 30)]), [start.text]);
  // Late enough and far enough.
  const later = iss(REPEAT_MS + 1, 100 + REPEAT_DEG + 1, 30);
  assert.deepEqual(said([start, later]), [start.text, later.text]);
});

test('bearings wrap: 359° to 2° is three degrees, not 357', () => {
  const a = iss(0, 359, 30);
  const b = iss(REPEAT_MS + 1, 2, 30);
  assert.deepEqual(said([a, b]), [a.text], 'a 3° move must not count as a 357° one');
});

test('a new target, a horizon crossing or a note is said at once', () => {
  const moon = { key: 'moon|up|', text: 'Moon: 142° round, 35° up.', az: 142, alt: 35, at: 1000 };
  const down = { ...iss(1200, 81, -2), key: 'iss|down|', text: 'Tracking the ISS: 81° round and 2° BELOW the horizon.' };
  const note = { key: 'none|-|That was the last planet.', text: 'That was the last planet.', az: null, alt: null, at: 1300 };
  const seq = [iss(0, 81, 3), moon, down, note];
  assert.deepEqual(said(seq), seq.map((s) => s.text));
});

test('a press is always answered, even of the target already chosen', () => {
  const a = iss(0, 81, 30);
  const again = { ...iss(200, 81, 30), force: true };
  assert.deepEqual(said([a, again]), [a.text, again.text]);
});

test('the same words are never said twice, and an empty line is not chatter', () => {
  const pole = { key: 'pole|up|', text: '', az: 0, alt: 33, at: 0 };
  assert.equal(said([pole, { ...pole, at: 50 }, { ...pole, at: REPEAT_MS * 2, az: 90 }]).length, 1);
});

test('the app speaks through the hidden region, by this rule', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
  const app = read('../site/src/app.js');
  const html = read('../site/index.html');
  const sw = read('../site/sw.js');
  assert.match(app, /import \{ nextAnnouncement \} from '\.\/announce\.js';/);
  assert.match(app, /announceTarget\(ringOn\);/, 'every pass of updateSkyMode goes through the rule');
  assert.match(html, /id="skyAnnounce" role="status"/);
  assert.doesNotMatch(html, /id="skyTarget" role="status"/, 'the drawn line must not be a live region again');
  assert.match(sw, /'\.\/src\/announce\.js'/, 'offline, the rule has to be there too');
  // Both ways of choosing the station count as a press.
  assert.ok((app.match(/heardForce = true;/g) || []).length >= 2);
});

// WHERE IT IS, IN WORDS (#222). Pressing a target above the horizon left the
// drawn line empty -- the ring says where it is -- and so a screen reader
// heard "Moon, pressed" and nothing about where the Moon was.

test('a target above the horizon is told to the reader in degrees and in words', () => {
  const app = readFileSync(fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
  const fn = app.slice(app.indexOf('function announceTarget('), app.indexOf('function setTarget('));
  assert.match(fn, /if \(!text && ringOn && ringOn\.alt >= 0\)/, 'only when nothing is drawn and it is up');
  assert.match(fn, /`\$\{ringOn\.name\}: \$\{az\}° round, \$\{compassWords\(az\)\}, `/);
  // The drawn line is left alone: the position goes to the reader only.
  assert.doesNotMatch(fn, /\$\('skyTarget'\)\.textContent =/);
});

test('compass points are spelled out, so "SE" is not read as two letters', async () => {
  const { compassWords } = await import('../site/src/words.js');
  assert.equal(compassWords(0), 'north');
  assert.equal(compassWords(359), 'north');
  assert.equal(compassWords(142), 'south-east');
  assert.equal(compassWords(22.5), 'north-north-east');
  assert.equal(compassWords(270), 'west');
  assert.equal(compassWords(-90), 'west');
});

test('the live region is inside the full-screen figure, so it is heard in full screen (#251)', () => {
  // Full screen is #liveSkyWrap alone; whatever is outside it leaves the
  // accessibility tree until full screen ends. NVDA heard nothing when
  // Polaris was pressed in full screen, and the Moon only after leaving it.
  const html = readFileSync(fileURLToPath(new URL('../site/index.html', import.meta.url)), 'utf8');
  const start = html.indexOf('id="liveSkyWrap"');
  const end = html.indexOf('</figure>', start);
  const at = html.indexOf('id="skyAnnounce"');
  assert.ok(start > 0 && end > start, 'the sky figure has moved; point this test at it');
  assert.ok(html.slice(start, end).indexOf('<figure') === -1, 'a figure nested in the sky figure would confuse this test');
  assert.ok(at > start && at < end, '#skyAnnounce must live inside #liveSkyWrap');
  assert.equal((html.match(/id="skyAnnounce"/g) || []).length, 1, 'one live region, not two');
});
