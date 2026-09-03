import assert from 'node:assert/strict';
import test from 'node:test';

import { FontLoadError, GlyphEngineStatusError, GlyphError } from '@pmndrs/glyph';

test('Glyph operational errors share one public base without erasing their reason or cause', () => {
  const cause = new Error('network failed');
  const load = new FontLoadError('BAKED_FONT_FETCH', 'font request failed', { cause });
  const engine = new GlyphEngineStatusError('shape', 0xffff_ffff);

  assert(load instanceof GlyphError);
  assert.equal(load.code, 'resource-unavailable');
  assert.equal(load.reason, 'BAKED_FONT_FETCH');
  assert.equal(load.cause, cause);

  assert(engine instanceof GlyphError);
  assert.equal(engine.code, 'engine-failed');
  assert.equal(engine.statusCode, 'unknown');
});
