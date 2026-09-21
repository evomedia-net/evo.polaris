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

test('the arrows are shown by the mode, not by a switch of their own', () => {
  // "In manual mode arrows appear" -- so the mode is the only thing that
  // decides it. The old padToggle was a second, independent switch over the
  // same thing, which is how a pad ends up hidden in the one mode that needs
  // it.
  assert.ok(!appJs.includes("$('padToggle')"), 'padToggle is back');
  // The pad lives in the Manual Controls card now, so the card's open state
  // carries what the hidden attribute used to. Still the MODE deciding it,
  // which is the thing this test is about.
  //
  // FROM skyFollow, NOT `following`. The two are not the same: `following` is
  // the mode AND a compass reading having arrived, so in Auto on a device
  // that has not reported -- a laptop always, an iPhone until the permission
  // tap -- it is false while Auto is plainly the mode. Asserting the old
  // expression here is what kept "manual controls are expanded on load but
  // system is in auto mode" pinned in place.
  assert.match(appJs, /if \(card\) card\.open = !skyFollow;/,
    'the Manual Controls card must open exactly when Manual is the mode');
  assert.ok(!appJs.includes("$('skyPad').hidden ="),
    'the pad must not also be hidden behind the card that already hides it');
  // ...and the on-map cluster deliberately does NOT follow that rule. The
  // line is between what the screen SAYS and what is LIVE: a card labelled
  // Manual Controls must agree with the button labelled Auto Mode, while
  // full screen has no card to open, so hiding its pad whenever Auto was
  // merely selected would strand a laptop with no way to steer at all.
  assert.ok(/\$\('fullPan'\)\.hidden = following;/.test(appJs),
    'the on-map pan cluster must stay driven by whether anything is steering');
  // Only on a change: updateSkyMode runs on every redraw, and forcing the
  // card each time would snap it shut under anyone who opened it by hand.
  assert.match(appJs, /if \(skyFollow !== lastFollowMode\)/,
    'the card must be driven by mode CHANGES, not by every redraw');
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
