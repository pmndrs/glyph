import type {
  BenchmarkControls,
  BenchmarkEnvironment,
  BenchmarkInput,
  BenchmarkMeasurement,
  BenchmarkScenario,
  BenchmarkSummary,
  BenchmarkTarget,
  RunnerEvent,
} from './contracts';
import { median, percentile } from './statistics';

let executionSequence = 0;

export interface RunBenchmarkOptions {
  readonly target: BenchmarkTarget;
  readonly scenario: BenchmarkScenario;
  readonly input: BenchmarkInput;
  readonly controls: BenchmarkControls;
  readonly environment: BenchmarkEnvironment;
  readonly onEvent?: (event: RunnerEvent) => void;
}

export function missingCapabilities(target: BenchmarkTarget, scenario: BenchmarkScenario): readonly string[] {
  return [...scenario.requiredCapabilities].filter((capability) => !target.capabilities.has(capability));
}

export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkSummary> {
  const { target, scenario, input, controls, environment, onEvent } = options;
  assertControls(controls);
  const missing = missingCapabilities(target, scenario);
  if (missing.length > 0) throw new Error(`Target lacks: ${missing.join(', ')}`);
  if (target.status(input) !== 'ready') throw new Error('Target is not ready for this input');
  target.configure?.(input);
  executionSequence += 1;
  const executionId = `run:${String(executionSequence)}`;

  onEvent?.({ phase: 'loading', completed: 0, total: 1 });
  try {
    await target.load(controls);
    for (let sample = 0; sample < controls.warmup; sample += 1) {
      onEvent?.({ phase: 'warming', completed: sample, total: controls.warmup });
      await target.run(input, 0, controls);
    }

    const measurements: BenchmarkMeasurement[] = [];
    for (let sample = 0; sample < controls.samples; sample += 1) {
      onEvent?.({ phase: 'sampling', completed: sample, total: controls.samples });
      const start = performance.now();
      const output = await target.run(input, sample, controls);
      const measurement: BenchmarkMeasurement = {
        sample,
        durationMs: performance.now() - start,
        outputBytes: output.bytes,
        hash: output.hash,
        ...(output.metrics === undefined ? {} : { metrics: output.metrics }),
      };
      measurements.push(measurement);
      const liveDurations = measurements.map(({ durationMs }) => durationMs);
      onEvent?.({
        phase: 'sampling',
        completed: sample + 1,
        total: controls.samples,
        latest: measurement,
        medianMs: median(liveDurations),
        p95Ms: percentile(liveDurations, 0.95),
      });
    }

    const validation = scenario.validate(measurements);
    const durations = measurements.map((measurement) => measurement.durationMs);
    const summary: BenchmarkSummary = {
      schemaVersion: 0,
      executionId,
      targetId: target.id,
      scenarioId: scenario.id,
      status: 'passed',
      controls,
      validation,
      measurements,
      medianMs: median(durations),
      p95Ms: percentile(durations, 0.95),
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
      outputBytes: measurements[0]?.outputBytes ?? 0,
      completedAt: new Date().toISOString(),
      environment,
    };
    const latest = measurements.at(-1);
    if (latest === undefined) throw new Error('benchmark completed without a measurement');
    onEvent?.({
      phase: 'complete',
      completed: controls.samples,
      total: controls.samples,
      latest,
      medianMs: summary.medianMs,
      p95Ms: summary.p95Ms,
    });
    return summary;
  } finally {
    await target.dispose();
  }
}

function assertControls(controls: BenchmarkControls): void {
  if (!Number.isFinite(controls.dpr) || controls.dpr <= 0 || controls.dpr > 4) {
    throw new RangeError('benchmark DPR must be finite and greater than zero but no greater than four');
  }
  if (!Number.isSafeInteger(controls.samples) || controls.samples <= 0) {
    throw new RangeError('benchmark samples must be a positive safe integer');
  }
  if (!Number.isSafeInteger(controls.warmup) || controls.warmup < 0) {
    throw new RangeError('benchmark warmup must be a nonnegative safe integer');
  }
}
