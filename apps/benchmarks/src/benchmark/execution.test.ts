import { describe, expect, it } from 'vitest'
import { runRegisteredBenchmark } from './execution'

const environment = {
  browser: 'vitest',
  hardwareConcurrency: 1,
  webgpu: false,
  crossOriginIsolated: false,
} as const

describe('registered benchmark execution', () => {
  it('runs the same registry used by interactive and browser automation', async () => {
    const summary = await runRegisteredBenchmark({
      targetId: 'synthetic',
      scenarioId: 'overview',
      input: {},
      controls: { samples: 3, warmup: 1 },
      environment,
    })

    expect(summary.targetId).toBe('synthetic')
    expect(summary.scenarioId).toBe('overview')
    expect(summary.measurements).toHaveLength(3)
    expect(summary.validation).toBe('3/3 deterministic outputs')
    expect(summary.measurements.map((measurement) => measurement.hash)).toEqual([
      'd9384dc5',
      'd9384dc5',
      'd9384dc5',
    ])
  })

  it('rejects unknown registry identities instead of silently changing a run', async () => {
    await expect(
      runRegisteredBenchmark({
        targetId: 'missing',
        scenarioId: 'overview',
        input: {},
        controls: { samples: 1, warmup: 0 },
        environment,
      }),
    ).rejects.toThrow('Unknown benchmark target: missing')
  })
})
