import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A DEPLOY MUST LAND ON THE FIRST RELOAD.
//
// "perseus didn't land in 1.25" -- it had. The page is drawn from the old
// worker's cache before the browser notices a new sw.js; the new worker
// installs, evicts the old cache and takes control, and the page keeps
// showing what it already loaded. Every deploy reached a returning visitor
// only on their SECOND reload, and nothing said so. Now the page reloads
// itself, once, when a new worker takes over a page that already had one.

const appJs = readFileSync(
  fileURLToPath(new URL('../site/src/app.js', import.meta.url)), 'utf8');
const sw = readFileSync(
  fileURLToPath(new URL('../site/sw.js', import.meta.url)), 'utf8');

test('the page reloads itself once when a new worker takes control', () => {
  const block = appJs.slice(appJs.indexOf("if ('serviceWorker' in navigator) {"),
    appJs.indexOf("navigator.serviceWorker.register('sw.js')"));
  assert.match(block, /addEventListener\('controllerchange'/, 'it listens for the handover');
  assert.match(block, /window\.location\.reload\(\);/, 'and reloads');
  // Guarded twice: a first visit has no previous controller and must not
  // reload, and a page must never reload more than once for one update.
  assert.match(block, /const hadController = Boolean\(navigator\.serviceWorker\.controller\);/);
  assert.match(block, /if \(!hadController \|\| reloadedForUpdate\) return;/);
  assert.match(block, /reloadedForUpdate = true;/);
});

test('the worker still takes control without waiting, or the reload would never fire', () => {
  assert.match(sw, /self\.skipWaiting\(\)/, 'a new worker activates at once');
  assert.match(sw, /self\.clients\.claim\(\)/, 'and claims the open pages, which is the controllerchange');
});
