import { selectNearestRank } from './retained-quantile';

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
    medianScheduleMs: selectNearestRank(schedule, scratch, length, 0.5),
    medianReadyMs: selectNearestRank(ready, scratch, length, 0.5),
    medianSceneMs: selectNearestRank(scene, scratch, length, 0.5),
    medianTotalMs: selectNearestRank(total, scratch, length, 0.5),
    p95ScheduleMs: selectNearestRank(schedule, scratch, length, 0.95),
    p95ReadyMs: selectNearestRank(ready, scratch, length, 0.95),
    p95SceneMs: selectNearestRank(scene, scratch, length, 0.95),
    p95TotalMs: selectNearestRank(total, scratch, length, 0.95),
  };
}
