import assert from 'node:assert/strict'
import test from 'node:test'

import { nearestBitmapStrikeIndex } from '../../dist/internal/bitmap-strike.js'

const strikes = [{ ppem: 16 }, { ppem: 32 }, { ppem: 48 }]

test('selects bitmap strikes from CSS size at the requested raster pixel ratio', () => {
  assert.equal(nearestBitmapStrikeIndex(strikes, 16, 1), 0)
  assert.equal(nearestBitmapStrikeIndex(strikes, 16, 2), 1)
  assert.equal(nearestBitmapStrikeIndex(strikes, 16, 3), 2)
})

test('chooses the deterministic lower strike at an exact distance tie', () => {
  assert.equal(nearestBitmapStrikeIndex(strikes, 24, 1), 0)
})

test('rejects invalid raster selection inputs', () => {
  assert.throws(() => nearestBitmapStrikeIndex([], 16, 1), /no strikes/)
  assert.throws(() => nearestBitmapStrikeIndex(strikes, 16, 0), /pixel ratio/)
})
