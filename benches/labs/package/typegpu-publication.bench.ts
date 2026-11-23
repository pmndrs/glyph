import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';

import { font, glyph } from './fixture.ts';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) throw new Error('Installed Glyph package root is required');
const { defineTypeGpuConfig } = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/typegpu.js')).href
)) as typeof import('@pmndrs/glyph/typegpu');
const { resourceLease } = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/core.js')).href
)) as typeof import('@pmndrs/glyph/core');
let nextHandle = 1;

const viewport = { width: 640, height: 480 } as const;

// This host records CPU adapter work; it does not measure GPU execution.
function createTypeGpuLabels(count: number) {
  const gpuGlobals = globalThis as typeof globalThis & {
    GPUBufferUsage?: Readonly<{ COPY_DST: number; STORAGE: number; VERTEX: number }>;
  };
  gpuGlobals.GPUBufferUsage ??= { COPY_DST: 8, STORAGE: 128, VERTEX: 32 };
  // A position reaches the GPU as a per-Text uniform (direct draws) or as one transform-table record (batched
  // draws). Either way it is one two-float write whose y is the label's; the 640x480 viewport write never matches.
  const stats = { publications: 0, movedY: Number.NaN, positionWrites: 0 };
  const recordWrite = (value: ArrayLike<number>) => {
    if (value.length === 2 && value[1] === stats.movedY) stats.positionWrites++;
  };
  const root = {
    createUniform() {
      return {
        buffer: { destroy() {} },
        value: [0, 0],
        write(value: readonly [number, number]) {
          recordWrite(value);
          this.value = [...value];
        },
      };
    },
    device: {
      createBuffer({ size, usage }: { readonly size: number; readonly usage: number }) {
        return { bytes: new Uint8Array(size), destroy() {}, size, usage };
      },
      queue: {
        writeBuffer(target: { readonly bytes: Uint8Array }, offset: number, data: ArrayBufferView) {
          if (data instanceof Float32Array) recordWrite(data);
          target.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
        },
      },
    },
  };
  const base = defineTypeGpuConfig({ root: root as never, format: 'rgba8unorm' });
  const config = {
    ...base,
    renderer: (context: Parameters<typeof base.renderer>[0]) => {
      const renderer = base.renderer(context);
      return {
        decode(frame: Parameters<typeof renderer.decode>[0]) {
          stats.publications++;
          return renderer.decode(frame);
        },
        syncTransforms(updates: Parameters<typeof renderer.syncTransforms>[0]) {
          renderer.syncTransforms(updates);
        },
        dispose: () => renderer.dispose(),
      };
    },
    // Direct draws (Slug, and MSDF before batching) prepare one draw per Text; indexed draws (MSDF and bitmap
    // since batching) bind once per buffer set. A stub without `bind` makes indexed spans take the direct path,
    // which has no per-Text transform to position by.
    resolve: () =>
      resourceLease(
        {
          prepare(..._arguments: unknown[]) {
            return { draw() {} };
          },
          bind() {
            return { watchedLanes: [], variant: () => 0, draw() {} };
          },
          dispose() {},
        },
        () => {},
      ),
  };
  const handle = glyph.handle(`labs:typegpu-position:${String(nextHandle++)}`, config);
  const labels = Array.from({ length: count }, (_, index) =>
    handle.createText({
      font,
      position: [index, 0],
      text: `label ${String(index).padStart(4, '0')}`,
      style: { fontSize: 16 },
    }),
  );
  glyph.shape();
  handle.draw({} as never, viewport);
  stats.publications = 0;
  return { handle, labels, stats };
}

group('TypeGPU adapter CPU publication @publication', () => {
  bench('move 1000 retained TypeGPU labels @position', function* () {
    const count = 1_000;
    const created = createTypeGpuLabels(count);
    let y = 0;

    // One frame: move every label, publish, and draw, which uploads transforms that publication left pending.
    const move = () => {
      const publicationCount = created.stats.publications;
      y = y === 1 ? 2 : 1;
      created.stats.movedY = y;
      created.stats.positionWrites = 0;
      for (let index = 0; index < created.labels.length; index++) {
        created.labels[index]!.update({ position: [index, y] });
      }
      glyph.shape();
      created.handle.draw({} as never, viewport);
      return {
        publications: created.stats.publications - publicationCount,
        positionWrites: created.stats.positionWrites,
      };
    };
    move();
    const result = yield move;
    try {
      if (process.env.GLYPH_LABS_ARTIFACT_ROLE === 'baseline') assert.equal(result.publications <= 1, true);
      else assert.equal(result.publications, 0);
      assert.equal(result.positionWrites, count);
    } finally {
      created.handle.dispose();
    }
  });
});
