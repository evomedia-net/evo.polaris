// Validates our WMM implementation against NOAA's own published test values,
// shipped inside WMM2025COF.zip. If this passes, the declination the app shows
// is the declination NOAA says it is.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { magneticField } from '../site/src/geomag.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Columns: year, alt(km), lat, lon, dec, inc, H, X, Y, Z, F, then rates.
const rows = readFileSync(join(HERE, 'fixtures', 'WMM2025_TestValues.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => l.trim().split(/\s+/).map(Number));

test('NOAA test values are present', () => {
  assert.ok(rows.length >= 10, `expected NOAA vectors, got ${rows.length}`);
});

test('declination matches NOAA to within 0.01 deg', () => {
  let worst = 0, worstRow = null;
  for (const r of rows) {
    const [year, alt, lat, lon, expDec] = r;
    const { declination } = magneticField(lat, lon, alt, year);
    // Declination wraps at +/-180; compare the smallest angular difference.
    let d = Math.abs(((declination - expDec + 540) % 360) - 180);
    if (d > worst) { worst = d; worstRow = r; }
  }
  assert.ok(
    worst < 0.01,
    `worst declination error ${worst.toFixed(4)} deg at ` +
    `year=${worstRow?.[0]} alt=${worstRow?.[1]} lat=${worstRow?.[2]} lon=${worstRow?.[3]}`,
  );
});

test('field components match NOAA to within 1 nT', () => {
  let worst = 0, which = '';
  for (const r of rows) {
    const [year, alt, lat, lon, , expInc, expH, expX, expY, expZ, expF] = r;
    const got = magneticField(lat, lon, alt, year);
    for (const [name, a, b] of [
      ['H', got.h, expH], ['X', got.x, expX], ['Y', got.y, expY],
      ['Z', got.z, expZ], ['F', got.f, expF],
    ]) {
      const d = Math.abs(a - b);
      if (d > worst) { worst = d; which = `${name} at lat=${lat} lon=${lon}`; }
    }
    assert.ok(Math.abs(got.inclination - expInc) < 0.01, `inclination at lat=${lat}`);
  }
  assert.ok(worst < 1.0, `worst component error ${worst.toFixed(3)} nT (${which})`);
});
