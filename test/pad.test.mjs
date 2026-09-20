import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The pan pad, and its full-screen twin.
//
// Both came from the same report off a real phone: "the controls to move the
// screen are not visible, so it's almost useless". The pad was greyed out
// while the phone was being followed, and full screen had no pan at all.

const root = new URL('../site/', import.meta.url);
const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');

const PAD = ['skyUp', 'skyDown', 'skyLeft', 'skyRight', 'skyPole'];

test('the pan buttons are never disabled', () => {
  // A disabled pad reads as absent on a dark screen, and it made the hand-off
  // in pan() -- "any button press drops out of follow mode" -- unreachable
  // from the one place anyone would look for it.
  const offenders = appJs.split('\n').filter((line) =>
    /\.disabled\s*=/.test(line) && PAD.some((id) => line.includes(id)));
  assert.deepEqual(offenders, [], 'a pad button is being disabled');
  // The old loop, specifically: a list of the pad ids followed by a disable.
  assert.ok(!/\[\s*'skyUp'[^\]]*\][\s\S]{0,120}\.disabled\s*=/.test(appJs),
    'the loop that greyed the pad out during following is back');
});

test('full screen carries the pad, in the pad arrangement, delegating to it', () => {
  const twins = [
    ['fullUp', 'skyUp', 'Look up', 'pad-up'],
    ['fullDown', 'skyDown', 'Look down', 'pad-down'],
    ['fullLeft', 'skyLeft', 'Look left', 'pad-left'],
    ['fullRight', 'skyRight', 'Look right', 'pad-right'],
    ['fullPole', 'skyPole', 'Find the pole', 'pad-mid'],
  ];
  const wrap = html.slice(html.indexOf('id="liveSkyWrap"'), html.indexOf('</figure>'));
  for (const [full, pad, label, area] of twins) {
    const tag = wrap.match(new RegExp(`<button[^>]*id="${full}"[^>]*>`));
    assert.ok(tag, `#${full} is not inside the sky figure`);
    assert.ok(tag[0].includes(`aria-label="${label}"`), `#${full} must be named "${label}"`);
    assert.ok(tag[0].includes(area), `#${full} must sit in the pad's ${area} cell`);
    assert.ok(appJs.includes(`$('${full}').onclick = () => $('${pad}').click();`),
      `#${full} must delegate to #${pad}, not carry its own copy of the step`);
  }
});
