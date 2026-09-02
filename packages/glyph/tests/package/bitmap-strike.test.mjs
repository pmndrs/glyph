import assert from 'node:assert/strict';
import test from 'node:test';

import { selectBitmapStrikePpem } from '../../dist/raster/bitmap.js';

const strikes = [{ ppem: 16 }, { ppem: 32 }, { ppem: 48 }];

test('selects bitmap strikes from CSS size at the requested raster pixel ratio', () => {
  assert.equal(selectBitmapStrikePpem(strikes, 16, 1), 16);
  assert.equal(selectBitmapStrikePpem(strikes, 16, 2), 32);
  assert.equal(selectBitmapStrikePpem(strikes, 16, 3), 48);
});

test('chooses the deterministic lower strike at an exact distance tie', () => {
  assert.equal(selectBitmapStrikePpem(strikes, 24, 1), 16);
});

test('rejects invalid raster selection inputs', () => {
  assert.throws(() => selectBitmapStrikePpem([], 16, 1), /no strikes/);
  assert.throws(() => selectBitmapStrikePpem(strikes, 16, 0), /pixel ratio/);
});
