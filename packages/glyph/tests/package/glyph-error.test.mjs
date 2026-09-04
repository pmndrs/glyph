import assert from 'node:assert/strict';
import test from 'node:test';

import { GlyphFontError, GlyphEngineStatusError, GlyphError } from '@pmndrs/glyph';

test('Glyph operational errors share one public base without erasing their reason or cause', () => {
  const cause = new Error('network failed');
  const font = new GlyphFontError('BAKED_FONT_FETCH', 'font request failed', { cause });
  const engine = new GlyphEngineStatusError('shape', 0xffff_ffff);

  assert(font instanceof GlyphError);
  assert.equal(font.name, 'GlyphFontError');
  assert.equal(font.code, 'resource-unavailable');
  assert.equal(font.reason, 'BAKED_FONT_FETCH');
  assert.equal(font.cause, cause);

  assert(engine instanceof GlyphError);
  assert.equal(engine.code, 'engine-failed');
  assert.equal(engine.statusCode, 'unknown');
});
