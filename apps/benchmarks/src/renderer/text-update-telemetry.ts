const SAMPLE_CAPACITY = 64

export interface TextUpdateSample {
  readonly scheduleMs: number
  readonly readyMs: number
  readonly sceneMs: number
  readonly totalMs: number
}

export interface TextUpdateTimingSummary {
  readonly sampleCount: number
  readonly medianScheduleMs: number
  readonly medianReadyMs: number
  readonly medianSceneMs: number
  readonly medianTotalMs: number
  readonly p95ScheduleMs: number
  readonly p95ReadyMs: number
  readonly p95SceneMs: number
  readonly p95TotalMs: number
}

export interface TextUpdateTelemetry {
  record(sample: TextUpdateSample): void
  summary(): TextUpdateTimingSummary
}

const EMPTY_SUMMARY: TextUpdateTimingSummary = Object.freeze({
  sampleCount: 0,
  medianScheduleMs: 0,
  medianReadyMs: 0,
  medianSceneMs: 0,
  medianTotalMs: 0,
  p95ScheduleMs: 0,
  p95ReadyMs: 0,
  p95SceneMs: 0,
  p95TotalMs: 0,
})

export function createTextUpdateTelemetry(): TextUpdateTelemetry {
  const schedule = new Float32Array(SAMPLE_CAPACITY)
  const ready = new Float32Array(SAMPLE_CAPACITY)
  const scene = new Float32Array(SAMPLE_CAPACITY)
  const total = new Float32Array(SAMPLE_CAPACITY)
  let length = 0
  let nextIndex = 0
  let current = EMPTY_SUMMARY

  return {
    record(sample) {
      schedule[nextIndex] = sample.scheduleMs
      ready[nextIndex] = sample.readyMs
      scene[nextIndex] = sample.sceneMs
      total[nextIndex] = sample.totalMs
      nextIndex = (nextIndex + 1) % SAMPLE_CAPACITY
      length = Math.min(length + 1, SAMPLE_CAPACITY)
      current = summarize(schedule, ready, scene, total, length)
    },
    summary() {
      return current
    },
  }
}

function summarize(
  schedule: Float32Array,
  ready: Float32Array,
  scene: Float32Array,
  total: Float32Array,
  length: number,
): TextUpdateTimingSummary {
  return {
    sampleCount: length,
    medianScheduleMs: percentile(schedule, length, 0.5),
    medianReadyMs: percentile(ready, length, 0.5),
    medianSceneMs: percentile(scene, length, 0.5),
    medianTotalMs: percentile(total, length, 0.5),
    p95ScheduleMs: percentile(schedule, length, 0.95),
    p95ReadyMs: percentile(ready, length, 0.95),
    p95SceneMs: percentile(scene, length, 0.95),
    p95TotalMs: percentile(total, length, 0.95),
  }
}

function percentile(values: Float32Array, length: number, quantile: number): number {
  if (length === 0) return 0
  const sorted = Array.from(values.subarray(0, length)).sort((left, right) => left - right)
  return sorted[Math.min(length - 1, Math.ceil(length * quantile) - 1)] ?? 0
}
