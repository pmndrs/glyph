import { describe, expect, it } from 'vitest';
import type { BenchmarkScenario, BenchmarkTarget, RunnerEvent } from './contracts';
import { missingCapabilities, runBenchmark } from './runner';

const target: BenchmarkTarget = {
  id: 'test',
  label: 'Test target',
  detail: 'test',
  color: 'violet',
  capabilities: new Set(['deterministic']),
  status: () => 'ready',
  load: async () => undefined,
  run: async () => ({ bytes: 12, hash: 'stable', metrics: { boundaryCrossings: 1 } }),
  dispose: async () => undefined,
};

const scenario: BenchmarkScenario = {
  id: 'test',
  label: 'Test scenario',
  description: 'test',
  requiredCapabilities: new Set(['deterministic']),
  validate: (measurements) => `${measurements.length} accepted`,
};

describe('shared benchmark runner', () => {
  it('reports accepted samples through one lifecycle', async () => {
    const events: RunnerEvent[] = [];
    const sampleIndexes: number[] = [];
    const result = await runBenchmark({
      target: {
        ...target,
        run: async (_input, sampleIndex) => {
          sampleIndexes.push(sampleIndex);
          return { bytes: 12, hash: 'stable', metrics: { boundaryCrossings: 1 } };
        },
      },
      scenario,
      input: {},
      controls: { dpr: 2, warmup: 1, samples: 3 },
      environment: {
        browser: 'vitest',
        hardwareConcurrency: 1,
        webgpu: false,
        crossOriginIsolated: false,
      },
      onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe('passed');
    expect(result.schemaVersion).toBe(0);
    expect(result.controls).toEqual({ dpr: 2, warmup: 1, samples: 3 });
    expect(result.measurements).toHaveLength(3);
    expect(result.measurements.every(({ metrics }) => metrics?.boundaryCrossings === 1)).toBe(true);
    expect(result.validation).toBe('3 accepted');
    expect(events.map(({ phase }) => phase)).toContain('complete');
    expect(
      events
        .filter(({ phase, latest }) => phase === 'sampling' && latest !== undefined)
        .map(({ completed }) => completed),
    ).toEqual([1, 2, 3]);
    expect(events.at(-1)).toMatchObject({
      phase: 'complete',
      completed: 3,
      medianMs: expect.any(Number),
      p95Ms: expect.any(Number),
    });
    expect(sampleIndexes).toEqual([0, 0, 1, 2]);
  });

  it('forwards one borrowed execution context through load, warmup, and measured samples', async () => {
    const controller = new AbortController();
    const executionContext = { signal: controller.signal };
    const observed: unknown[] = [];

    await runBenchmark({
      target: {
        ...target,
        load: async (_controls, context) => {
          observed.push(context);
        },
        run: async (_input, _sampleIndex, _controls, context) => {
          observed.push(context);
          return { bytes: 12, hash: 'stable' };
        },
      },
      scenario,
      input: {},
      controls: { dpr: 1, warmup: 1, samples: 2 },
      environment: {
        browser: 'vitest',
        hardwareConcurrency: 1,
        webgpu: false,
        crossOriginIsolated: false,
      },
      executionContext,
    });

    expect(observed).toEqual([executionContext, executionContext, executionContext, executionContext]);
  });

  it('rejects invalid controls before loading a target', async () => {
    await expect(
      runBenchmark({
        target,
        scenario,
        input: {},
        controls: { dpr: 1, warmup: 0, samples: 0 },
        environment: {
          browser: 'vitest',
          hardwareConcurrency: 1,
          webgpu: false,
          crossOriginIsolated: false,
        },
      }),
    ).rejects.toThrow('samples must be a positive safe integer');
  });

  it('rejects an invalid DPR before loading a target', async () => {
    await expect(
      runBenchmark({
        target,
        scenario,
        input: {},
        controls: { dpr: 0, warmup: 0, samples: 1 },
        environment: {
          browser: 'vitest',
          hardwareConcurrency: 1,
          webgpu: false,
          crossOriginIsolated: false,
        },
      }),
    ).rejects.toThrow('DPR must be finite');
  });

  it('lists capabilities instead of coercing unsupported targets', () => {
    expect(
      missingCapabilities(target, {
        ...scenario,
        requiredCapabilities: new Set(['raster', 'gpu-timestamps']),
      }),
    ).toEqual(['raster', 'gpu-timestamps']);
  });

  it('disposes partial target state when loading fails', async () => {
    let disposed = 0;
    const failingTarget: BenchmarkTarget = {
      ...target,
      load: async () => {
        throw new Error('fixture load failed');
      },
      dispose: async () => {
        disposed += 1;
      },
    };

    await expect(
      runBenchmark({
        target: failingTarget,
        scenario,
        input: {},
        controls: { dpr: 1, warmup: 0, samples: 1 },
        environment: {
          browser: 'vitest',
          hardwareConcurrency: 1,
          webgpu: false,
          crossOriginIsolated: false,
        },
      }),
    ).rejects.toThrow('fixture load failed');
    expect(disposed).toBe(1);
  });
});
