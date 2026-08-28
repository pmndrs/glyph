import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  createTextRuntime,
  type PlanTarget,
  type SynchronousTextEngineSession,
  type TextEngineRenderPlanReader,
} from '@pmndrs/glyph/core';
import { describe, expect, test } from 'vitest';

import { ExampleTextEngine } from '../src/engine.js';
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
  test('publishes synchronously without exposing raw revisions or frame bytes', async () => {
    const runtime = await createTextRuntime({ wasm: await wasmBytes() });
    const engine = new ExampleTextEngine(runtime);
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
      runtime.dispose();
    }
  });

  test('expires borrowed plans and prevents sibling Wasm re-entry', async () => {
    const runtime = await createTextRuntime({ wasm: await wasmBytes() });
    const host = runtime.createTextEngineHost({ integration: 'glyph-example-renderer-test/borrow' });
    const policy = host.installPolicy(exampleRenderPolicyDescriptor(host.wireIdentities));
    let retainedReader: TextEngineRenderPlanReader | undefined;
    let retainedTransformResolver: ((transformIndex: number) => unknown) | undefined;
    let sibling: SynchronousTextEngineSession;
    const siblingTarget: PlanTarget = {
      delivery: 'borrowed',
      accept: () => ({ accepted: true }),
      dispose() {},
    };
    sibling = host.createSession({
      policy,
      target: () => siblingTarget,
      limits: LIMITS,
      ...CAPACITIES,
    });
    const target: PlanTarget = {
      delivery: 'borrowed',
      accept(candidate) {
        retainedReader = candidate.plan;
        retainedTransformResolver = candidate.resolveTransform;
        expect(() => sibling.publish()).toThrow(/borrowed render plan/i);
        return { accepted: true };
      },
      dispose() {},
    };
    const session = host.createSession({
      policy,
      target: () => target,
      limits: LIMITS,
      ...CAPACITIES,
    });
    try {
      expect(session.publish()).toEqual({ accepted: true });
      expect(() => retainedReader!.table('draws')).toThrow(/expired/);
      expect(() => retainedTransformResolver!(1)).toThrow(/expired/);
    } finally {
      host.dispose();
      runtime.dispose();
    }
    expect(session.disposed).toBe(true);
    expect(sibling.disposed).toBe(true);
  });

  test('claims one target for exactly one session and cascades disposal', async () => {
    const runtime = await createTextRuntime({ wasm: await wasmBytes() });
    const host = runtime.createTextEngineHost({ integration: 'glyph-example-renderer-test/ownership' });
    const policy = host.installPolicy(exampleRenderPolicyDescriptor(host.wireIdentities));
    let disposals = 0;
    const target: PlanTarget = {
      delivery: 'borrowed',
      accept: () => ({ accepted: true }),
      dispose: () => {
        disposals += 1;
      },
    };
    const session = host.createSession({
      policy,
      target: () => target,
      limits: LIMITS,
      ...CAPACITIES,
    });
    expect(() =>
      host.createSession({
        policy,
        target: () => target,
        limits: LIMITS,
        ...CAPACITIES,
      }),
    ).toThrow(/already attached/);
    expect(disposals).toBe(0);
    host.dispose();
    expect(session.disposed).toBe(true);
    expect(disposals).toBe(1);
    runtime.dispose();
  });

  test('rejects impossible output limits before constructing a target', async () => {
    const runtime = await createTextRuntime({ wasm: await wasmBytes() });
    const host = runtime.createTextEngineHost({ integration: 'glyph-example-renderer-test/limits' });
    const policy = host.installPolicy(exampleRenderPolicyDescriptor(host.wireIdentities));
    let targetConstructions = 0;
    const target: PlanTarget = {
      delivery: 'borrowed',
      accept: () => ({ accepted: true }),
      dispose() {},
    };
    const create = (maxOutputBytes: number) =>
      host.createSession({
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
      host.dispose();
      runtime.dispose();
    }
  });
});
