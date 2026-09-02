import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { glyph, loadFont, type CommandBufferView } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { rasterBake } from '@pmndrs/glyph/baker';
import { afterEach, expect, test } from 'vitest';

import glyphExampleBaker from '@pmndrs/glyph-example-raster/baker';
import { glyphExample, glyphExampleSuppliedGeometryDeclaration } from '@pmndrs/glyph-example-raster';
import {
  defineExampleConfig,
  exampleRendererShader,
  RecordingExampleRendererDevice,
  type ExamplePendingSubmission,
  type ExampleRendererDevice,
} from '../src/index.js';
import type { ExampleBindings } from '../src/config.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const shaperWasm = new URL('../../glyph/dist/text-shaper.wasm', import.meta.url);
const temporaryDirectories: string[] = [];

class RejectOnceExampleRendererDevice implements ExampleRendererDevice {
  readonly primary = new RecordingExampleRendererDevice();
  readonly shader = this.primary.shader;
  failNextPreparation = false;
  discarded = 0;

  decode(frame: CommandBufferView<ExampleBindings>): ExamplePendingSubmission {
    const pending = this.primary.decode(frame);
    if (this.failNextPreparation) {
      this.failNextPreparation = false;
      pending.discard();
      this.discarded += 1;
      throw new Error('injected renderer preparation failure');
    }
    return pending;
  }

  reset(): void {
    this.primary.reset();
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('the public handle publishes the shared bound hierarchy into a renderer-owned draw list', async () => {
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

  await glyph.init({ wasm: await readFile(shaperWasm) });
  const device = new RejectOnceExampleRendererDevice();
  const handle = glyph.handle('example:bound-renderer', defineExampleConfig(device));
  const bytes = await readFile(output);
  const font = await loadFont(
    { baked: `data:model/gltf-binary;base64,${bytes.toString('base64')}` },
    { technique: glyphExample, options: { paletteSeed: 7 } },
  );
  try {
    const text = handle.createText({
      font,
      text: 'Glyph',
      fontSize: 48,
      width: 1000,
      height: 1000,
    });

    device.failNextPreparation = true;
    expect(() => text.publish()).toThrow('injected renderer preparation failure');
    expect(device.discarded).toBe(1);
    expect(device.primary.resources.size).toBe(0);

    const accepted = text.publish();
    expect(accepted.changed).toBe(true);
    expect(accepted.draws.length).toBeGreaterThan(0);
    expect(device.primary.resourcesByName.has('glyphGeometry')).toBe(true);
    expect(device.primary.buffersByName.has('origin')).toBe(true);
    expect(device.primary.buffersByName.has('size')).toBe(true);
    expect(device.primary.buffersByName.has('color')).toBe(true);
    expect(device.primary.realizedDraws).toHaveLength(accepted.draws.length);
    for (const realized of device.primary.realizedDraws) {
      expect(realized.draw.primitive).toBe(realized.primitive);
      expect(realized.geometry).toMatchObject({
        kind: 'supplied',
        indexed: true,
        vertexCount: 4,
        indexCount: 6,
        resourceName: 'glyphGeometry',
      });
      expect(realized.geometry.instanceCount).toBe(realized.primitive.recordCount);
      expect(realized.buffers.get('origin')).toBeInstanceOf(Uint8Array);
      expect(realized.resources.get('glyphGeometry')).toBeDefined();
    }

    const acceptedDraws = [...device.primary.realizedDraws];
    const idle = handle.publish();
    expect(idle.changed).toBe(false);
    expect(idle.draws).toEqual([]);
    expect(device.primary.realizedDraws).toEqual(acceptedDraws);

    text.update({ text: 'updated', color: '#ff8040' });
    const updated = text.publish();
    expect(updated.changed).toBe(true);
    expect(updated.draws.length).toBeGreaterThan(0);
    expect(text.text).toBe('updated');

    text.dispose();
    handle.publish();
    expect(device.primary.resources.size).toBe(0);
  } finally {
    handle.dispose();
    font.dispose();
  }
  expect(device.primary.resources.size).toBe(0);
});

test('shader declarations remain a validated user boundary', () => {
  expect(
    () =>
      new RecordingExampleRendererDevice({
        ...exampleRendererShader,
        variant: {
          ...exampleRendererShader.variant,
          geometry: glyphExampleSuppliedGeometryDeclaration,
        },
      }),
  ).toThrow('registered portable geometry and resource schema');
});
