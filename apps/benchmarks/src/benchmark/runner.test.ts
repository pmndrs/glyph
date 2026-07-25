import { describe, expect, it } from 'vitest'
import type { BenchmarkScenario, BenchmarkTarget } from './contracts'
import { missingCapabilities, runBenchmark } from './runner'

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
}

const scenario: BenchmarkScenario = {
  id: 'test',
  label: 'Test scenario',
  description: 'test',
  requiredCapabilities: new Set(['deterministic']),
  validate: (measurements) => `${measurements.length} accepted`,
}

describe('shared benchmark runner', () => {
  it('reports accepted samples through one lifecycle', async () => {
    const phases: string[] = []
    const result = await runBenchmark({
      target,
      scenario,
      input: {},
      controls: { warmup: 1, samples: 3 },
      environment: {
        browser: 'vitest',
        hardwareConcurrency: 1,
        webgpu: false,
        crossOriginIsolated: false,
      },
      onEvent: (event) => phases.push(event.phase),
    })

    expect(result.status).toBe('passed')
    expect(result.measurements).toHaveLength(3)
    expect(result.measurements.every(({ metrics }) => metrics?.boundaryCrossings === 1)).toBe(true)
    expect(result.validation).toBe('3 accepted')
    expect(phases).toContain('complete')
  })

  it('lists capabilities instead of coercing unsupported targets', () => {
    expect(
      missingCapabilities(target, {
        ...scenario,
        requiredCapabilities: new Set(['raster', 'gpu-timestamps']),
      }),
    ).toEqual(['raster', 'gpu-timestamps'])
  })

  it('disposes partial target state when loading fails', async () => {
    let disposed = 0
    const failingTarget: BenchmarkTarget = {
      ...target,
      load: async () => {
        throw new Error('fixture load failed')
      },
      dispose: async () => {
        disposed += 1
      },
    }

    await expect(
      runBenchmark({
        target: failingTarget,
        scenario,
        input: {},
        controls: { warmup: 0, samples: 1 },
        environment: {
          browser: 'vitest',
          hardwareConcurrency: 1,
          webgpu: false,
          crossOriginIsolated: false,
        },
      }),
    ).rejects.toThrow('fixture load failed')
    expect(disposed).toBe(1)
  })
})
