import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { glyph, type CommandBufferView } from '@pmndrs/glyph';
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
        packaging: { artifact: 'embedded' },
        options: { paletteSeed: 7 },
      }),
    ],
  });

  await glyph.init({ wasm: await readFile(shaperWasm) });
  const device = new RejectOnceExampleRendererDevice();
  const handle = glyph.handle('example:bound-renderer', defineExampleConfig(device));
  const bytes = await readFile(output);
  const font = glyph.fontFace(new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }), {
    format: glyphExample({ paletteSeed: 7 }),
  });
  await font.load();
  try {
    const text = handle.createText({
      font,
      text: 'Glyph',
      fontSize: 48,
      width: 1000,
      height: 1000,
    });

    glyph.shape();
    text.update({ text: 'Glyph!' });
    glyph.shape();
    const accepted = handle.drawList;
    expect(accepted.changed).toBe(true);
    expect(accepted.draws.length).toBeGreaterThan(0);
    const resourceEntry = [...device.primary.resources].at(0);
    if (resourceEntry === undefined) throw new Error('expected one resolved geometry resource');
    const [resourceBinding, resource] = resourceEntry;
    expect(resource.kind).toBe('geometry');
    expect(resourceBinding.resource).toBe(resource);
    expect(device.primary.resourcesByName.get(resourceBinding.name)).toBe(resource);
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
      expect(realized.placementOffset).toBeInstanceOf(Uint8Array);
      expect(realized.resources.get('glyphGeometry')).toBeDefined();
    }

    const acceptedDraws = [...device.primary.realizedDraws];
    const acceptedSubmissions = device.primary.submissions.length;
    glyph.shape();
    expect(handle.drawList).toBe(accepted);
    expect(device.primary.submissions).toHaveLength(acceptedSubmissions);
    expect(device.primary.realizedDraws).toEqual(acceptedDraws);

    text.update({ text: 'Portable TypeGPU reflow', fontSize: 64, width: 360, height: 192 });
    glyph.shape();
    const narrowDrawCount = handle.drawList.draws.length;
    const narrowVisibleRecordEnd = device.primary.realizedDraws.reduce(
      (end, realized) => Math.max(end, realized.primitive.recordIndex + realized.primitive.recordCount),
      0,
    );
    const narrowOrigin = device.primary.buffersByName.get('origin')?.slice();
    const narrowPlacement = device.primary.realizedDraws.at(0)?.placementOffset.slice();
    if (narrowOrigin === undefined || narrowPlacement === undefined)
      throw new Error('expected retained reflow buffers');

    text.update({ width: 720 });
    glyph.shape();
    const reflowed = handle.drawList;
    const wideOrigin = device.primary.buffersByName.get('origin');
    const widePlacement = device.primary.realizedDraws.at(0)?.placementOffset;
    expect(reflowed.changed).toBe(true);
    expect(reflowed.draws).toHaveLength(narrowDrawCount);
    expect(device.primary.realizedDraws).toHaveLength(narrowDrawCount);
    const wideVisibleRecordEnd = device.primary.realizedDraws.reduce(
      (end, realized) => Math.max(end, realized.primitive.recordIndex + realized.primitive.recordCount),
      0,
    );
    const narrowVisibleOriginBytes = narrowVisibleRecordEnd * 2 * Float32Array.BYTES_PER_ELEMENT;
    const wideVisibleOriginBytes = wideVisibleRecordEnd * 2 * Float32Array.BYTES_PER_ELEMENT;
    expect(wideVisibleRecordEnd).toBeGreaterThan(narrowVisibleRecordEnd);
    expect(wideOrigin?.slice(0, narrowVisibleOriginBytes)).toEqual(narrowOrigin.slice(0, narrowVisibleOriginBytes));
    expect(wideOrigin?.slice(narrowVisibleOriginBytes, wideVisibleOriginBytes).some((byte) => byte !== 0)).toBe(true);
    expect(widePlacement).not.toEqual(narrowPlacement);
    expect(widePlacement?.some((byte) => byte !== 0)).toBe(true);

    const retainedResourceCount = device.primary.resources.size;
    const retainedSubmissionCount = device.primary.submissions.length;
    expect(retainedResourceCount).toBeGreaterThan(0);
    device.failNextPreparation = true;
    text.update({ text: 'Rejected update' });
    expect(() => glyph.shape()).toThrow('injected renderer preparation failure');
    expect(device.discarded).toBe(1);
    expect(device.primary.resources.size).toBe(retainedResourceCount);
    expect(device.primary.submissions).toHaveLength(retainedSubmissionCount);

    text.update({ text: 'Recovered update' });
    glyph.shape();

    text.dispose();
    glyph.shape();
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
