import { describe, expect, it } from 'vitest';
import type { BenchmarkControls, BenchmarkExecutionContext, BenchmarkInput, TargetRunOutput } from '../../../contracts';
import type { RasterConformanceAdapter, RasterConformanceSession } from './contracts';
import { createRasterSamplingConformanceTarget, createRasterSourceOutlineConformanceTarget } from './target';

const controls: BenchmarkControls = { dpr: 2, samples: 1, warmup: 0 };
const input: BenchmarkInput = { fontFixture: 'dot-gothic-16' };
const output: TargetRunOutput = { bytes: 4, hash: 'candidate' };

function createSession(overrides: Partial<RasterConformanceSession> = {}): RasterConformanceSession {
  return {
    load: async () => undefined,
    captureSampling: async () => output,
    captureSourceOutline: async () => ({
      candidate: new Uint8Array([1, 2, 3, 4]),
      width: 1,
      height: 1,
      physicalPpem: 32,
      meanAbsoluteError: 0,
      maximumError: 0,
      errorPixels: 0,
      renderSubmitMs: 1,
    }),
    dispose: async () => undefined,
    ...overrides,
  };
}

function createAdapter(
  create: RasterConformanceAdapter['createSession'],
  technique: RasterConformanceAdapter['technique'] = 'mtsdf',
): RasterConformanceAdapter {
  return { technique, createSession: create };
}

describe('raster conformance target session', () => {
  it('keeps one warm session and forwards the same borrowed renderer to every sampling phase', async () => {
    const calls: unknown[][] = [];
    const session = createSession({
      load: async (...args) => {
        calls.push(['load', ...args]);
      },
      captureSampling: async (...args) => {
        calls.push(['capture', ...args]);
        return output;
      },
    });
    const target = createRasterSamplingConformanceTarget(
      createAdapter(async () => session),
      'webgpu',
    );
    const renderer = {} as NonNullable<BenchmarkExecutionContext['renderer']>;
    const context: BenchmarkExecutionContext = { renderer };

    target.configure?.(input);
    await target.load(controls, context);
    await expect(target.run(input, 0, controls, context)).resolves.toEqual(output);
    await expect(target.run(input, 1, controls, context)).resolves.toEqual(output);

    expect(calls).toEqual([
      ['load', input, controls, context],
      ['capture', input, 0, controls, context],
      ['capture', input, 1, controls, context],
    ]);
  });

  it('disposes a created session after a load failure and permits a clean replacement session', async () => {
    let creates = 0;
    let disposals = 0;
    const target = createRasterSamplingConformanceTarget(
      createAdapter(async () => {
        creates += 1;
        return createSession({
          load: async () => {
            if (creates === 1) throw new Error('fixture load failed');
          },
          dispose: async () => {
            disposals += 1;
          },
        });
      }),
      'webgl2',
    );

    await expect(target.load(controls)).rejects.toThrow('fixture load failed');
    await target.dispose();
    await target.load(controls);
    await target.dispose();

    expect({ creates, disposals }).toEqual({ creates: 2, disposals: 2 });
  });

  it('does not create a session after abort and leaves an existing session disposable after a capture abort', async () => {
    let creates = 0;
    let disposals = 0;
    const session = createSession({
      dispose: async () => {
        disposals += 1;
      },
    });
    const target = createRasterSamplingConformanceTarget(
      createAdapter(async () => {
        creates += 1;
        return session;
      }),
      'webgpu',
    );
    const beforeLoad = new AbortController();
    beforeLoad.abort();

    await expect(target.load(controls, { signal: beforeLoad.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(creates).toBe(0);

    await target.load(controls);
    const beforeCapture = new AbortController();
    beforeCapture.abort();
    await expect(target.run(input, 0, controls, { signal: beforeCapture.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await target.dispose();

    expect({ creates, disposals }).toEqual({ creates: 1, disposals: 1 });
  });

  it('waits for an in-flight session creation before disposal so no late session survives navigation', async () => {
    let resolve: ((session: RasterConformanceSession) => void) | undefined;
    const created = new Promise<RasterConformanceSession>((complete) => {
      resolve = complete;
    });
    let disposals = 0;
    const session = createSession({
      dispose: async () => {
        disposals += 1;
      },
    });
    const target = createRasterSamplingConformanceTarget(
      createAdapter(async () => created),
      'webgpu',
    );

    const loading = target.load(controls);
    const disposing = target.dispose();
    const loadingFailure = loading.then(
      () => new Error('Expected disposal to abort the in-flight session load'),
      (error: unknown) => error,
    );
    resolve?.(session);
    await expect(loadingFailure).resolves.toMatchObject({ name: 'AbortError' });
    await disposing;

    expect(disposals).toBe(1);
    await expect(target.run(input, 0, controls)).rejects.toThrow('MTSDF conformance target was not loaded');
  });

  it('keeps source-outline capture isolated in the session and restores host state on a failed capture', async () => {
    const rendererState = { target: 'host-target' };
    let disposals = 0;
    const target = createRasterSourceOutlineConformanceTarget(
      createAdapter(
        async () =>
          createSession({
            captureSourceOutline: async (_input, _controls, context) => {
              const host = context?.renderer as unknown as { state: { target: string } };
              const prior = host.state.target;
              try {
                host.state.target = 'finite-capture-target';
                throw new Error('readback failed');
              } finally {
                host.state.target = prior;
              }
            },
            dispose: async () => {
              disposals += 1;
            },
          }),
        'slug',
      ),
      'webgpu',
    );
    const renderer = { state: rendererState } as unknown as NonNullable<BenchmarkExecutionContext['renderer']>;

    await target.load(controls, { renderer });
    await expect(target.run(input, 0, controls, { renderer })).rejects.toThrow('readback failed');
    expect(rendererState).toEqual({ target: 'host-target' });
    await target.dispose();
    expect(disposals).toBe(1);
  });
});
