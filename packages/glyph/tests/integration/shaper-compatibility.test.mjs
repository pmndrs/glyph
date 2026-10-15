import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import binaryen from 'binaryen';
import { bitmap, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { loadFont } from '../../dist/loader.js';

const legacyUrl = new URL('../fixtures/wasm/text-shaper-v0.wasm', import.meta.url);

test('public initialization rejects incompatible modules before use and matched modules support semantic queries', async (t) => {
  const legacy = await readFile(legacyUrl);
  const provenance = JSON.parse(await readFile(new URL('text-shaper-v0.json', legacyUrl), 'utf8'));
  assert.equal(createHash('sha256').update(legacy).digest('hex'), provenance.sha256);
  assert.equal(provenance.revision, 'd7ffcbbdc5a38635604570f76395005e2d195d9a');
  assert.equal(provenance.semanticRecordBytes, 76);
  let runtimeId = 0;
  for (const wasm of [legacy, await WebAssembly.compile(legacy)]) {
    const { glyph: isolatedGlyph } = await import(`../../dist/glyph.js?legacy-${runtimeId++}`);
    const initializing = isolatedGlyph.init({ wasm });
    await assert.rejects(initializing, /incompatible text shaper Wasm ABI: expected 1/);
    assert.equal(isolatedGlyph.initialized, false);
    assert.equal(
      isolatedGlyph.init({ wasm }),
      initializing,
      'unchanged fatal initialization keeps its rejected promise',
    );
  }
  const incompatible = binaryen.parseText(`(module
    (memory (export "memory") 1)
    (func (export "pmndrs_glyph_shaper_abi_version") (result i32) (i32.const 2))
    (func (export "pmndrs_glyph_shaper_initialize") (result i32) unreachable))`);
  try {
    const { glyph: isolatedGlyph } = await import('../../dist/glyph.js?future-abi');
    await assert.rejects(
      isolatedGlyph.init({ wasm: incompatible.emitBinary() }),
      /incompatible text shaper Wasm ABI: expected 1, received 2/,
    );
    assert.equal(isolatedGlyph.initialized, false);
  } finally {
    incompatible.dispose();
  }
  await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
  assert.equal(glyph.initialized, true);
  const font = await loadFont(
    {
      baked: {
        bytes: await readFile(
          new URL('../../../../benches/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url),
        ),
      },
    },
    bitmap({ strikes: [16, 32] }),
  );
  const handle = glyph.handle('abi-compatibility', ThreeConfig);
  t.after(() => {
    handle.dispose();
    font.dispose();
  });
  const text = handle.createText({
    font,
    text: 'Cap x',
    style: { fontSize: 20 },
    constraints: { anchor: { x: 'center', y: 'cap-height-top' } },
  });
  const measure = text.measure();
  assert.ok(measure.fontMetrics.capHeight > 0);
  assert.equal(measure.anchorOffset.y, -measure.capHeightTop);
  assert.equal(text.glyphs().glyphCount, 5);
});
