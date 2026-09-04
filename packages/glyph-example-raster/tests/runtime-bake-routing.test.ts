import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createFontBaker, fontBakerWasmUrl } from '@pmndrs/glyph/bake';
import { glyph } from '@pmndrs/glyph';
import { test } from 'vitest';

import { glyphExample } from '../src/index.js';

const fixtureDirectory = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url);

interface BakeFontRequest {
  readonly type: 'bake-font-v0';
  readonly id: number;
  readonly source: ArrayBuffer;
}

type WorkerMessageListener = (event: Readonly<{ data: unknown }>) => void;

/** Proves the external-format contract end to end: FontFace loads `glyphExample` and bakes it host-side, while the core Worker only ever handles built-in bake-font messages. */
test('the example raster format bakes host-side while the Worker plan stays first-party', async () => {
  const source = await readFile(new URL('Inter-Regular.ttf', fixtureDirectory));
  const fontBaker = await createFontBaker(await readFile(new URL(fontBakerWasmUrl)));
  const baked = fontBaker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0]!;
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  class FixtureWorker {
    readonly listeners = new Map<string, WorkerMessageListener>();

    addEventListener(type: string, listener: WorkerMessageListener): void {
      this.listeners.set(type, listener);
    }

    postMessage(value: BakeFontRequest, transfer: Transferable[]): void {
      assert.deepEqual(transfer, [value.source]);
      const received = structuredClone(value, { transfer });
      queueMicrotask(() => {
        this.listeners.get('message')?.({
          data: {
            type: 'bake-font-result-v0',
            id: received.id,
            ok: true,
            artifacts: [
              {
                role: 'font',
                id: baked.id,
                bytes: Uint8Array.from(baked.bytes).buffer,
                fingerprint: baked.fingerprint,
              },
            ],
            report: {},
            warnings: [],
          },
        });
      });
    }

    terminate(): void {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FixtureWorker });
  const face = glyph.fontFace(new Blob([source], { type: 'font/ttf' }), {
    family: 'ExternalRasterRuntimeBake',
    format: glyphExample({ paletteSeed: 17, inset: 0.1 }),
  });
  try {
    assert.equal(await face.load(), face);
    assert.equal(face.isLoaded(), true);
  } finally {
    face.dispose();
    if (originalWorker === undefined) Reflect.deleteProperty(globalThis, 'Worker');
    else Object.defineProperty(globalThis, 'Worker', originalWorker);
  }
});
