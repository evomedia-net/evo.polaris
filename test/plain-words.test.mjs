import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compassSummary } from '../site/src/words.js';

// WHAT A PERSON READS UNDER THE SKY VIEW, IN PLAIN WORDS.
//
// "What is the station and is the really long word correct without any
// spaces? Can you kind of summarize what all is going on in this paragraph?"
// Two lines under the sky view read like notes to a developer: a caption that
// never named the International Space Station (#191), and a raw sensor dump
// shown to everyone (#192). These hold both to the words a person needs.

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');

const issCaption = () => {
  const m = html.match(/<p class="hint" id="issOut">([\s\S]*?)<\/p>/);
  assert.ok(m, 'the ISS caption is gone');
  return m[1].replace(/\s+/g, ' ').trim();
};

test('the ISS caption names the station and the button it is about', () => {
  const text = issCaption();
  assert.match(text, /International Space Station/, 'say what "the station" is');
  assert.match(text, /Find the ISS/, 'name the button, which is not beside the caption');
  assert.match(text, /internet/);
  for (const jargon of [/radio/, /Press this/, /api\./, /the device\b/]) {
    assert.doesNotMatch(text, jargon, `${jargon} is a developer's word, not a reader's`);
  }
});

test('the messages that replace the caption say "space station" too', () => {
  assert.match(appJs, /'Asking where the space station is…'/);
  assert.match(appJs, /Could not reach the space station tracker/);
  assert.match(appJs, /'Where the space station is can only be looked up for right now, not '/);
  assert.doesNotMatch(appJs, /'Asking where the station is…'|reach the station tracker/);
});

// --- the compass line (#192) ------------------------------------------------

test('the compass line says, in words, where the phone is pointing', () => {
  const absolute = { event: 'deviceorientationabsolute', absolute: true };
  // The phone in the report: alpha 342 is a heading of 18, east of north.
  assert.equal(compassSummary(absolute, 18.2), 'Compass working — the phone is pointing 18° NNE.');
  assert.equal(compassSummary(absolute, 359.6), 'Compass working — the phone is pointing 0° N.');
  assert.equal(compassSummary(absolute, -90), 'Compass working — the phone is pointing 270° W.');
  assert.equal(compassSummary(absolute, null), 'Compass working — waiting for a heading.');
  assert.equal(compassSummary({ event: null, absolute: null }, 18), '', 'no sensor, no line');
});

test('a compass that may not know north still gets the warning, in plain words', () => {
  for (const absolute of [false, null]) {
    const line = compassSummary({ event: 'deviceorientation', absolute }, 18);
    assert.match(line, /does not|did not/);
    assert.match(line, /may be turned the wrong way/);
    assert.match(line, /arrow buttons/);
    assert.doesNotMatch(line, /absolute|alpha|event/, 'no sensor jargon in the warning');
  }
  // A plain event that says it IS absolute is fine.
  assert.match(compassSummary({ event: 'deviceorientation', absolute: true }, 18), /^Compass working/);
});

test('the visible line is the summary; the raw values wait behind a button', () => {
  const fn = appJs.slice(appJs.indexOf('function updateSensorReadout('),
    appJs.indexOf('\n}', appJs.indexOf('function updateSensorReadout(')));
  assert.match(fn, /el\.textContent = compassSummary\(sensorInfo, heading\);/);
  assert.match(fn, /\$\('sensorRaw'\)\.textContent =/);
  assert.doesNotMatch(fn, /el\.textContent =\s*\n?\s*`\$\{sensorInfo\.event/, 'the dump must not be the visible line');
  assert.match(html,
    /<button id="sensorToggle" class="big-btn ghost" aria-expanded="false"\s+aria-controls="sensorRaw" hidden>Show sensor details<\/button>/);
  assert.match(html, /<p class="hint" id="sensorRaw" hidden><\/p>/);
  // The label says what pressing does, both ways, and aria-expanded follows.
  assert.match(appJs, /raw\.hidden \? 'Show sensor details' : 'Hide sensor details'/);
  assert.match(appJs, /setAttribute\('aria-expanded', String\(!raw\.hidden\)\)/);
});
