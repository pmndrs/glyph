import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FontRegistry,
  RasterRuntime,
  rasterBake,
  type GlyphPaint,
  type ParagraphLayout,
  type RasterKey,
  type RasterResolverContext,
  type RasterResourceResolverContext,
  type Sha256Hex,
} from '@pmndrs/text';
import { bakeFont } from '@pmndrs/text/bake';
import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, test, vi } from 'vitest';

import glyphDebugBaker from '../src/baker.js';
import { dirtyRanges, retainedCapacity } from '../src/capacity.js';
import { GLYPH_DEBUG_KIND, glyphDebug, glyphDebugDescriptor, glyphDebugModule } from '../src/index.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('public external raster proof', () => {
  test('adds bounded slack and coalesces fragmented writes into one full upload', () => {
    expect(retainedCapacity(1)).toBe(2);
    expect(retainedCapacity(1_024)).toBe(1_280);
    expect(retainedCapacity(2_048)).toBe(2_304);

    const count = 18 * 32;
    const current = new Float32Array(count);
    const replacement = new Float32Array(count);
    for (let bucket = 0; bucket < 18; bucket += 2) replacement[bucket * 32] = 1;
    expect(dirtyRanges(current, replacement, count, count, 1)).toEqual([{ start: 0, count }]);
  });

  test('bakes deterministic standalone companion bytes', async () => {
    const request = {
      font: {
        source: new Uint8Array(),
        fontFaceIndex: 0,
        glyphCount: 5,
        shapingHash: '1'.repeat(64) as Sha256Hex,
      },
      rasterKey: '2'.repeat(64) as RasterKey,
      packaging: { artifact: 'external', pages: 'external' } as const,
      descriptor: glyphDebugDescriptor({ paletteSeed: 7, inset: 0.1 }),
    };
    const [left, right] = await Promise.all([glyphDebugBaker.bake(request), glyphDebugBaker.bake(request)]);

    expect(left).toEqual(right);
    expect(left.kind).toBe(GLYPH_DEBUG_KIND);
    expect(left.artifacts.map(({ role }) => role)).toEqual(['raster', 'raster-page']);
    expect(left.artifacts[0]?.bytes.subarray(0, 4)).toEqual(Uint8Array.of(0x67, 0x6c, 0x54, 0x46));
  });

  test('bakes, authenticates, loads, and resolves package-owned external records through public APIs', async () => {
    const baked = await bakeFixture({ artifact: 'external', pages: 'external' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    const companion = baked.execution.outputs.find(({ role }) => role === 'raster');
    const records = baked.execution.outputs.find(({ role }) => role === 'raster-page');
    assert.ok(core && companion && records);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const runtime = new RasterRuntime();
    const resolve = vi.fn(async (_context: RasterResolverContext) => readFile(companion.file));
    const resolveResource = vi.fn(async (_context: RasterResourceResolverContext) => readFile(records.file));

    try {
      const loaded = await runtime.load(font, glyphDebug({ paletteSeed: 7 }), { resolve, resolveResource });
      expect(loaded.artifact.kind).toBe(GLYPH_DEBUG_KIND);
      expect(loaded.resource.colors.byteLength).toBe(font.glyphCount * 4);
      expect(resolve).toHaveBeenCalledOnce();
      expect(resolveResource).toHaveBeenCalledOnce();
      expect(resolve.mock.calls[0]?.[0].reference.kind).toBe(GLYPH_DEBUG_KIND);
      expect(resolveResource.mock.calls[0]?.[0].source.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      runtime.dispose();
      font.dispose();
    }
  });

  test('retains success and shrink, preserves live state on abort, and replaces overflow', async () => {
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const runtime = new RasterRuntime();
    const loaded = await runtime.load(font, glyphDebug({ paletteSeed: 7 }));
    let resourceDisposals = 0;
    loaded.resource.material.addEventListener('dispose', () => {
      resourceDisposals += 1;
    });

    const emptyStage = glyphDebugModule.stageBatch(undefined, layout([]), loaded.resource, 0, paint(0), 1);
    emptyStage.commit();
    expect(emptyStage.batch.glyphCount).toBe(0);
    expect(emptyStage.batch.capacity).toBe(0);
    expect(emptyStage.batch.object.children).toHaveLength(0);
    const growFromEmpty = glyphDebugModule.stageBatch(emptyStage.batch, layout([1]), loaded.resource, 0, paint(1), 1);
    expect(growFromEmpty.batch).not.toBe(emptyStage.batch);
    growFromEmpty.abort();
    expect(emptyStage.batch.object.children).toHaveLength(0);
    emptyStage.batch.dispose();

    const initialStage = glyphDebugModule.stageBatch(undefined, layout([1, 2]), loaded.resource, 0, paint(2), 1);
    initialStage.commit();
    const initial = initialStage.batch;
    const geometry = meshGeometry(initial.object);
    const initialCapacity = initial.capacity;
    expect(initial.glyphCount).toBe(2);
    expect(geometry.instanceCount).toBe(2);

    const aborted = glyphDebugModule.stageBatch(initial, layout([3]), loaded.resource, 0, paint(1), 1);
    expect(aborted.batch).toBe(initial);
    aborted.abort();
    expect(initial.glyphCount).toBe(2);
    expect(geometry.instanceCount).toBe(2);

    const shrink = glyphDebugModule.stageBatch(initial, layout([3]), loaded.resource, 0, paint(1), 1);
    shrink.commit();
    expect(shrink.batch).toBe(initial);
    expect(initial.glyphCount).toBe(1);
    expect(geometry.instanceCount).toBe(1);

    expect(() =>
      glyphDebugModule.stageBatch(initial, layout([font.glyphCount]), loaded.resource, 0, paint(1), 1),
    ).toThrow(/unavailable glyph/);
    expect(initial.glyphCount).toBe(1);
    expect(geometry.instanceCount).toBe(1);

    const exact = glyphDebugModule.stageBatch(
      initial,
      layout(Array.from({ length: initialCapacity }, (_, index) => index + 1)),
      loaded.resource,
      0,
      paint(initialCapacity),
      1,
    );
    exact.commit();
    expect(exact.batch).toBe(initial);
    expect(initial.glyphCount).toBe(initialCapacity);

    const overflowCount = initialCapacity + 1;
    const overflow = glyphDebugModule.stageBatch(
      initial,
      layout(Array.from({ length: overflowCount }, (_, index) => index + 1)),
      loaded.resource,
      0,
      paint(overflowCount),
      1,
    );
    expect(overflow.batch).not.toBe(initial);
    overflow.abort();
    expect(initial.glyphCount).toBe(initialCapacity);
    expect(overflow.batch.object.children).toHaveLength(0);

    initial.dispose();
    initial.dispose();
    runtime.dispose();
    runtime.dispose();
    await Promise.resolve();
    expect(resourceDisposals).toBe(1);
    font.dispose();
  });

  test('honors cancellation before loading and leaves no decoded resource', async () => {
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const runtime = new RasterRuntime();
    const controller = new AbortController();
    controller.abort(new DOMException('cancel glyph-debug load', 'AbortError'));

    expect(() => runtime.load(font, glyphDebug(), { signal: controller.signal })).toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    );
    runtime.dispose();
    font.dispose();
  });
});

async function bakeFixture(packaging: {
  readonly artifact: 'embedded' | 'external';
  readonly pages: 'embedded' | 'external';
}) {
  const directory = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-debug-'));
  temporaryDirectories.push(directory);
  return bakeFont({
    input: source,
    output: join(directory, 'inter.font.glb'),
    font: { fontFaceIndex: 0 },
    rasters: [rasterBake(glyphDebugBaker, { packaging, options: { paletteSeed: 7 } })],
  });
}

function layout(glyphIds: readonly number[]): ParagraphLayout {
  const count = glyphIds.length;
  return {
    width: count * 12,
    height: 16,
    contentWidth: count * 12,
    contentHeight: 16,
    firstBaseline: 12,
    lastBaseline: 12,
    overflowed: false,
    fontHandles: Uint32Array.of(1),
    glyphFontSlots: new Uint16Array(count),
    glyphIds: Uint16Array.from(glyphIds),
    clusters: Uint32Array.from(glyphIds, (_glyph, index) => index),
    glyphFontSizes: Float32Array.from({ length: count }, () => 16),
    x: Float32Array.from({ length: count }, (_value, index) => index * 12),
    y: Float32Array.from({ length: count }, () => 12),
    glyphFlags: new Uint16Array(count),
    lineTextStarts: Uint32Array.of(0),
    lineTextEnds: Uint32Array.of(count),
    lineGlyphStarts: Uint32Array.of(0),
    lineGlyphCounts: Uint32Array.of(count),
    lineBaselines: Float32Array.of(12),
    lineAdvances: Float32Array.of(count * 12),
  };
}

function paint(count: number): GlyphPaint {
  return {
    palette: [{ color: [1, 1, 1, 1] }],
    paintIndices: new Uint16Array(count),
  };
}

function meshGeometry(group: THREE.Group): THREE.InstancedBufferGeometry {
  const mesh = group.children[0];
  assert.ok(mesh instanceof THREE.Mesh);
  assert.ok(mesh.geometry instanceof THREE.InstancedBufferGeometry);
  return mesh.geometry;
}
