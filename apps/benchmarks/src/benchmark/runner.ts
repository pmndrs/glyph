import type {
  BenchmarkControls,
  BenchmarkEnvironment,
  BenchmarkInput,
  BenchmarkMeasurement,
  BenchmarkScenario,
  BenchmarkSummary,
  BenchmarkTarget,
  RunnerEvent,
} from './contracts'
import { median, percentile } from './statistics'

export interface RunBenchmarkOptions {
  readonly target: BenchmarkTarget
  readonly scenario: BenchmarkScenario
  readonly input: BenchmarkInput
  readonly controls: BenchmarkControls
  readonly environment: BenchmarkEnvironment
  readonly onEvent?: (event: RunnerEvent) => void
}

export function missingCapabilities(
  target: BenchmarkTarget,
  scenario: BenchmarkScenario,
): readonly string[] {
  return [...scenario.requiredCapabilities].filter(
    (capability) => !target.capabilities.has(capability),
  )
}

export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkSummary> {
  const { target, scenario, input, controls, environment, onEvent } = options
  const missing = missingCapabilities(target, scenario)
  if (missing.length > 0) throw new Error(`Target lacks: ${missing.join(', ')}`)
  if (target.status(input) !== 'ready') throw new Error('Target is not ready for this input')

  onEvent?.({ phase: 'loading', completed: 0, total: 1 })
  await target.load()
  try {
    for (let sample = 0; sample < controls.warmup; sample += 1) {
      onEvent?.({ phase: 'warming', completed: sample, total: controls.warmup })
      await target.run(input, 0)
    }

    const measurements: BenchmarkMeasurement[] = []
    for (let sample = 0; sample < controls.samples; sample += 1) {
      onEvent?.({ phase: 'sampling', completed: sample, total: controls.samples })
      const start = performance.now()
      const output = await target.run(input, 0)
      measurements.push({
        sample,
        durationMs: performance.now() - start,
        outputBytes: output.bytes,
        hash: output.hash,
        ...(output.metrics === undefined ? {} : { metrics: output.metrics }),
      })
    }

    const validation = scenario.validate(measurements)
    const durations = measurements.map((measurement) => measurement.durationMs)
    const summary: BenchmarkSummary = {
      targetId: target.id,
      scenarioId: scenario.id,
      status: 'passed',
      validation,
      measurements,
      medianMs: median(durations),
      p95Ms: percentile(durations, 0.95),
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
      outputBytes: measurements[0]?.outputBytes ?? 0,
      completedAt: new Date().toISOString(),
      environment,
    }
    onEvent?.({ phase: 'complete', completed: controls.samples, total: controls.samples })
    return summary
  } finally {
    await target.dispose()
  }
}
