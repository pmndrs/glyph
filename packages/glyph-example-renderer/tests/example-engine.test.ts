import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { glyph } from '@pmndrs/glyph';
import { describe, expect, test } from 'vitest';

import { defineExampleConfig, type ExampleGlyphConfig } from '../src/config.js';

const require = createRequire(import.meta.url);

async function wasmBytes(): Promise<Buffer> {
  return readFile(require.resolve('@pmndrs/glyph/text-shaper.wasm'));
}

describe('a retained engine driven through GlyphConfig', () => {
  test('uses the root Glyph handle and the same configured publication phases as Three', async () => {
    await glyph.init({ wasm: await wasmBytes() });
    const base = defineExampleConfig();
    let rendererFactories = 0;
    let rendererDecodeCalls = 0;
    const config: ExampleGlyphConfig = {
      ...base,
      renderer(context) {
        rendererFactories += 1;
        const renderer = base.renderer(context);
        return {
          decode(frame) {
            rendererDecodeCalls += 1;
            expect(frame.delivery).toBe('borrowed-command-buffer');
            return renderer.decode(frame);
          },
          syncTransforms: (updates) => renderer.syncTransforms(updates),
          dispose: () => renderer.dispose(),
        };
      },
    };
    const handle = glyph.handle('example:configured-test', config);
    try {
      expect(handle.publish().publicationGeneration).toBe(1);
      expect(handle.publish().publicationGeneration).toBe(2);
      expect(rendererFactories).toBe(1);
      expect(rendererDecodeCalls).toBe(2);
    } finally {
      handle.dispose();
    }
  });

  test('publishes synchronously without exposing raw revisions or frame bytes', async () => {
    await glyph.init({ wasm: await wasmBytes() });
    const handle = glyph.handle('example:publication-test', defineExampleConfig());
    try {
      const first = handle.publish();
      const second = handle.publish();
      expect(first.publicationGeneration).toBe(1);
      expect(first.engineRevision).toBe(1);
      expect(first.draws).toEqual([]);
      expect(second.publicationGeneration).toBe(2);
      expect(second.engineRevision).toBe(2);
    } finally {
      handle.dispose();
    }
  });

  test('rolls back a failed renderer decode and accepts the next publication', async () => {
    await glyph.init({ wasm: await wasmBytes() });
    const base = defineExampleConfig();
    let attempts = 0;
    const config: ExampleGlyphConfig = {
      ...base,
      renderer(context) {
        const renderer = base.renderer(context);
        return {
          decode(frame) {
            attempts += 1;
            if (attempts === 1) throw new Error('intentional decode failure');
            return renderer.decode(frame);
          },
          syncTransforms: (updates) => renderer.syncTransforms(updates),
          dispose: () => renderer.dispose(),
        };
      },
    };
    const handle = glyph.handle('example:decode-recovery', config);
    try {
      expect(() => handle.publish()).toThrow(/intentional decode failure/);
      expect(handle.publish().draws).toEqual([]);
      expect(attempts).toBe(2);
    } finally {
      handle.dispose();
    }
  });
});
