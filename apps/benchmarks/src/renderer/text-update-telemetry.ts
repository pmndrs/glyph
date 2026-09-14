const SAMPLE_CAPACITY = 64;

export interface TextUpdateTimingSummary {
  readonly sampleCount: number;
  readonly medianScheduleMs: number;
  readonly medianReadyMs: number;
  readonly medianSceneMs: number;
  readonly medianTotalMs: number;
  readonly p95ScheduleMs: number;
  readonly p95ReadyMs: number;
  readonly p95SceneMs: number;
  readonly p95TotalMs: number;
}

export interface TextUpdateTelemetry {
  record(scheduleMs: number, readyMs: number, sceneMs: number, totalMs: number): void;
  summary(): TextUpdateTimingSummary;
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
});

export function createTextUpdateTelemetry(): TextUpdateTelemetry {
  const schedule = new Float32Array(SAMPLE_CAPACITY);
  const ready = new Float32Array(SAMPLE_CAPACITY);
  const scene = new Float32Array(SAMPLE_CAPACITY);
  const total = new Float32Array(SAMPLE_CAPACITY);
  const scratch = new Float32Array(SAMPLE_CAPACITY);
  let length = 0;
  let nextIndex = 0;
  let current = EMPTY_SUMMARY;
  let dirty = false;

  return {
    record(scheduleMs, readyMs, sceneMs, totalMs) {
      schedule[nextIndex] = scheduleMs;
      ready[nextIndex] = readyMs;
      scene[nextIndex] = sceneMs;
      total[nextIndex] = totalMs;
      nextIndex = (nextIndex + 1) % SAMPLE_CAPACITY;
      length = Math.min(length + 1, SAMPLE_CAPACITY);
      dirty = true;
    },
    summary() {
      if (dirty) {
        current = summarize(schedule, ready, scene, total, scratch, length);
        dirty = false;
      }
      return current;
    },
  };
}

function summarize(
  schedule: Float32Array,
  ready: Float32Array,
  scene: Float32Array,
  total: Float32Array,
  scratch: Float32Array,
  length: number,
): TextUpdateTimingSummary {
  return {
    sampleCount: length,
    medianScheduleMs: percentile(schedule, scratch, length, 0.5),
    medianReadyMs: percentile(ready, scratch, length, 0.5),
    medianSceneMs: percentile(scene, scratch, length, 0.5),
    medianTotalMs: percentile(total, scratch, length, 0.5),
    p95ScheduleMs: percentile(schedule, scratch, length, 0.95),
    p95ReadyMs: percentile(ready, scratch, length, 0.95),
    p95SceneMs: percentile(scene, scratch, length, 0.95),
    p95TotalMs: percentile(total, scratch, length, 0.95),
  };
}

function percentile(values: Float32Array, scratch: Float32Array, length: number, quantile: number): number {
  if (length === 0) return 0;
  for (let index = 0; index < length; index += 1) scratch[index] = values[index] ?? 0;
  const selectedIndex = Math.min(length - 1, Math.ceil(length * quantile) - 1);
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const pivot = scratch[(left + right) >>> 1] ?? 0;
    let lower = left;
    let upper = right;
    while (lower <= upper) {
      while ((scratch[lower] ?? 0) < pivot) lower += 1;
      while ((scratch[upper] ?? 0) > pivot) upper -= 1;
      if (lower > upper) break;
      const value = scratch[lower] ?? 0;
      scratch[lower] = scratch[upper] ?? 0;
      scratch[upper] = value;
      lower += 1;
      upper -= 1;
    }
    if (selectedIndex <= upper) right = upper;
    else if (selectedIndex >= lower) left = lower;
    else break;
  }
  return scratch[selectedIndex] ?? 0;
}
