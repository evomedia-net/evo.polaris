// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE SKY WENT BLACK ON LEAVING FULL SCREEN, AND STAYED BLACK.
//
// "When I exited full screen, I got the black image ... When I tried to go
// back in to reset it ... it's black as well. So exiting full screen breaks
// and can't be fixed." And then: "Closing the browser and returning fixed it."
//
// No error, nothing in storage, cured by a reload, on a phone, at the moment
// two full-screen canvases are being reallocated: a lost 2D canvas context.
// Every draw call on one is silently ignored, and the browser only restores
// it if the page cancels the contextlost event. The WebGL layer has done
// that since it was written. The 2D canvas had not. These pin that both do.

const root = new URL('../site/', import.meta.url);
const appJs = readFileSync(fileURLToPath(new URL('src/app.js', root)), 'utf8');
const milky = readFileSync(fileURLToPath(new URL('src/milkyway.js', root)), 'utf8');

const handler = (src, event) => {
  const at = src.indexOf(`addEventListener('${event}'`);
  assert.notEqual(at, -1, `no ${event} handler`);
  return src.slice(at, src.indexOf('});', at));
};

test('the sky canvas cancels contextlost, so the browser will restore it', () => {
  // Without preventDefault there is no contextrestored, ever: the canvas is
  // dead until the page is reloaded, which is exactly what was reported.
  const lost = handler(appJs, 'contextlost');
  assert.match(lost, /e\.preventDefault\(\);/, 'the cancel IS the request to restore');
  assert.match(lost, /canvasLosses \+= 1;/, 'and it is counted');
});

test('on contextrestored the canvas is sized and everything is drawn again', () => {
  // A restored context comes back BLANK -- restoring is not repainting.
  const back = handler(appJs, 'contextrestored');
  assert.match(back, /sizeSkyCanvas\(\);/);
  assert.match(back, /drawLiveSky\(\);/);
});

test('a loss is named on the diagnostics line, in both modes', () => {
  // Not reproducible on a desktop, which never loses a context, so the one
  // way to learn it happened again on a phone is for the page to say so.
  assert.match(appJs, /function noteCanvasLoss\(\)/);
  assert.match(appJs, /Canvas context lost \$\{canvasLosses\}/, 'the count, for Manual Mode');
  const sensor = appJs.slice(appJs.indexOf('function updateSensorReadout('),
    appJs.indexOf('\n}', appJs.indexOf('function updateSensorReadout(')));
  assert.match(sensor, /canvasLosses \? ` · canvas context lost \$\{canvasLosses\}/,
    'Auto Mode rewrites the line every frame, so the count must ride on it');
});

test('the WebGL layer keeps doing the same for its own context', () => {
  assert.match(handler(milky, 'webglcontextlost'), /e\.preventDefault\(\);/);
  assert.match(handler(milky, 'webglcontextrestored'), /buildProgram\(\) && uploadTexture\(\)/);
});
