import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTextRuntime, rasterBake } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { textRuntimeShaper } from '@pmndrs/glyph/core';
import { afterEach, expect, test } from 'vitest';

import glyphExampleBaker from '@pmndrs/glyph-example-raster/baker';
import { glyphExample } from '@pmndrs/glyph-example-raster';
import { RecordingExampleRendererDevice } from '../src/device.js';
import { ExampleTextEngine } from '../src/engine.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const shaperWasm = new URL('../../glyph/dist/text-shaper.wasm', import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('loads a font, binds the portable raster, and submits non-empty example draws', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glyph-example-renderer-'));
  temporaryDirectories.push(directory);
  const output = join(directory, 'inter.font.glb');
  await bakeFont({
    input: source,
    output,
    font: { fontFaceIndex: 0 },
    rasters: [
      rasterBake(glyphExampleBaker, {
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { paletteSeed: 7 },
      }),
    ],
  });

  const runtime = await createTextRuntime({ wasm: await readFile(shaperWasm) });
  const device = new RecordingExampleRendererDevice();
  const engine = new ExampleTextEngine(textRuntimeShaper(runtime), device);
  try {
    const bytes = await readFile(output);
    const font = await runtime.loadFont({
      input: { baked: `data:model/gltf-binary;base64,${bytes.toString('base64')}` },
      raster: { technique: glyphExample, options: { paletteSeed: 7 } },
    });
    try {
      const binding = engine.registerFont(font);
      engine.registerFontStack(17, [binding]);
      engine.openSession(29);
      const list = engine.render({
        paragraphMutations: [{ opcode: 'upsert', paragraphId: 1, order: 0 }],
        textMutations: [{ paragraphId: 1, start: 0, deleteCount: 0, insert: 'glyph' }],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: 1,
            styleId: 1,
            cascadeOrder: 0,
            start: 0,
            end: 5,
            root: true,
            value: { fontStackHandle: 17, fontSize: 48, rasterPixelRatio: 1, foregroundRgba: 0xffff_ffff },
          },
        ],
        constraints: [
          {
            paragraphId: 1,
            flowThreadId: 1,
            geometryRevision: 1,
            width: 1000,
            height: 1000,
            viewportBlockStart: 0,
            viewportBlockEnd: 1000,
            resumeBlockOffset: 0,
            maxLines: 32,
            regionStart: 0,
            resumeCluster: 0,
            regionCount: 1,
            resumeRegion: 0,
            widthMode: 'at-most',
            heightMode: 'at-most',
            wrap: 'word',
            align: 'start',
            overflow: 'visible',
            blockAlign: 'start',
          },
        ],
        regions: [
          {
            id: 1,
            geometryRevision: 1,
            shape: 'rectangle',
            exclusionStart: 0,
            exclusionCount: 0,
            writingMode: 'horizontal-tb',
            textOrientation: 'mixed',
            inlineStart: 0,
            blockStart: 0,
            inlineEnd: 1000,
            blockEnd: 1000,
            clipInlineStart: 0,
            clipBlockStart: 0,
            clipInlineEnd: 1000,
            clipBlockEnd: 1000,
          },
        ],
      });

      expect(list.draws.length).toBeGreaterThan(0);
      expect(device.resources.size).toBeGreaterThan(0);
      expect(device.submissions).toHaveLength(1);
      expect(device.submissions[0]?.draws.length).toBeGreaterThan(0);
    } finally {
      engine.dispose();
      font.dispose();
    }
  } finally {
    runtime.dispose();
  }
});
