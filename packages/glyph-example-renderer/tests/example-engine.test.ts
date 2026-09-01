import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { createGlyphEngine, type PlanTarget, type RenderPlanner, type RenderPlanReader } from '@pmndrs/glyph/core';
import { glyph } from '@pmndrs/glyph';
import { describe, expect, test } from 'vitest';

import { ExampleTextEngine } from '../src/engine.js';
import { defineExampleConfig, type ExampleGlyphConfig } from '../src/config.js';
import { exampleRenderPolicyDescriptor } from '../src/policy.js';

const require = createRequire(import.meta.url);

async function wasmBytes(): Promise<Buffer> {
  return readFile(require.resolve('@pmndrs/glyph/text-shaper.wasm'));
}

const LIMITS = Object.freeze({
  maxParagraphs: 8,
  maxClusters: 256,
  maxLines: 32,
  maxRegions: 4,
  maxExclusions: 4,
  maxInlineObjects: 4,
  maxSlotsPerBand: 4,
  maxOutputBytes: 128 * 1024,
});

const CAPACITIES = Object.freeze({
  requestCapacity: 4096,
  resultCapacity: 128 * 1024,
  textCapacity: 4096,
});

describe('a retained engine driven through the published core surface', () => {
  test('uses the root Glyph handle and the same configured publication phases as Three', async () => {
    await glyph.init({ wasm: await wasmBytes() });
    const base = defineExampleConfig();
    let decodeCalls = 0;
    let rendererFactories = 0;
    let prepareCalls = 0;
    const config: ExampleGlyphConfig = {
      ...base,
      decode(source, context) {
        decodeCalls += 1;
        return base.decode(source, context);
      },
      renderer(context) {
        rendererFactories += 1;
        const renderer = base.renderer(context);
        return {
          prepare(frame) {
            prepareCalls += 1;
            expect(frame.delivery).toBe('borrowed-bound');
            return renderer.prepare(frame);
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
      expect(decodeCalls).toBe(2);
      expect(prepareCalls).toBe(2);
    } finally {
      handle.dispose();
    }
  });

  test('publishes synchronously without exposing raw revisions or frame bytes', async () => {
    const glyphEngine = await createGlyphEngine({ wasm: await wasmBytes() });
    const engine = new ExampleTextEngine(glyphEngine);
    try {
      const first = engine.publish();
      const second = engine.publish();
      expect(first.publicationGeneration).toBe(1);
      expect(first.engineRevision).toBe(1);
      expect(first.draws).toEqual([]);
      expect(second.publicationGeneration).toBe(2);
      expect(second.engineRevision).toBe(2);
    } finally {
      engine.dispose();
      glyphEngine.dispose();
    }
  });

  test('expires borrowed plans and prevents sibling Wasm re-entry', async () => {
    const glyphEngine = await createGlyphEngine({ wasm: await wasmBytes() });
    const backend = glyphEngine.createBackend({ integration: 'glyph-example-renderer-test/borrow' });
    const policy = backend.installPolicy(exampleRenderPolicyDescriptor);
    let retainedReader: RenderPlanReader | undefined;
    let sibling: RenderPlanner;
    const siblingTarget: PlanTarget = {
      delivery: 'borrowed',
      accept: () => ({ accepted: true }),
      dispose() {},
    };
    sibling = backend.createPlanner({
      policy,
      target: () => siblingTarget,
      limits: LIMITS,
      ...CAPACITIES,
    });
    const target: PlanTarget = {
      delivery: 'borrowed',
      accept(candidate) {
        retainedReader = candidate.plan;
        expect(() => sibling.publish()).toThrow(/borrowed render plan/i);
        return { accepted: true };
      },
      dispose() {},
    };
    const planner = backend.createPlanner({
      policy,
      target: () => target,
      limits: LIMITS,
      ...CAPACITIES,
    });
    try {
      expect(planner.publish()).toEqual({ accepted: true });
      expect(() => retainedReader!.table('draws')).toThrow(/expired/);
    } finally {
      backend.dispose();
      glyphEngine.dispose();
    }
    expect(planner.disposed).toBe(true);
    expect(sibling.disposed).toBe(true);
  });

  test('claims one target for exactly one render planner and cascades disposal', async () => {
    const glyphEngine = await createGlyphEngine({ wasm: await wasmBytes() });
    const backend = glyphEngine.createBackend({ integration: 'glyph-example-renderer-test/ownership' });
    const policy = backend.installPolicy(exampleRenderPolicyDescriptor);
    let disposals = 0;
    const target: PlanTarget = {
      delivery: 'borrowed',
      accept: () => ({ accepted: true }),
      dispose: () => {
        disposals += 1;
      },
    };
    const planner = backend.createPlanner({
      policy,
      target: () => target,
      limits: LIMITS,
      ...CAPACITIES,
    });
    expect(() =>
      backend.createPlanner({
        policy,
        target: () => target,
        limits: LIMITS,
        ...CAPACITIES,
      }),
    ).toThrow(/already attached/);
    expect(disposals).toBe(0);
    backend.dispose();
    expect(planner.disposed).toBe(true);
    expect(disposals).toBe(1);
    glyphEngine.dispose();
  });

  test('rejects impossible output limits before constructing a target', async () => {
    const glyphEngine = await createGlyphEngine({ wasm: await wasmBytes() });
    const backend = glyphEngine.createBackend({ integration: 'glyph-example-renderer-test/limits' });
    const policy = backend.installPolicy(exampleRenderPolicyDescriptor);
    let targetConstructions = 0;
    const target: PlanTarget = {
      delivery: 'borrowed',
      accept: () => ({ accepted: true }),
      dispose() {},
    };
    const create = (maxOutputBytes: number) =>
      backend.createPlanner({
        policy,
        target: () => {
          targetConstructions += 1;
          return target;
        },
        limits: { ...LIMITS, maxOutputBytes },
        ...CAPACITIES,
      });

    try {
      expect(() => create(1)).toThrow(/result header/);
      expect(() => create(64 * 1024 * 1024 + 1)).toThrow(/engine limit/);
      expect(targetConstructions).toBe(0);
    } finally {
      backend.dispose();
      glyphEngine.dispose();
    }
  });
});
