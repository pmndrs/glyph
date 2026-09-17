export const FRAME_TIME_WARMUP_FRAMES = 30;
export const FRAME_TIME_SAMPLE_FRAMES = 120;

export interface AnimationFrameTarget {
  requestAnimationFrame(callback: FrameRequestCallback): number;
}

export interface DurationSummary {
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly sampleCount: number;
}

export interface FrameTimeSummary extends DurationSummary {
  readonly framesPerSecond: number;
}

export interface FrameTimeSample {
  readonly frameTimesMs: Float64Array;
  readonly summary: FrameTimeSummary;
}

export interface AnimationPerformanceSample extends FrameTimeSample {
  readonly cpuTime: DurationSummary;
  readonly cpuTimesMs: Float64Array;
}

export async function sampleAnimationPerformance(
  target: AnimationFrameTarget,
  captureCpuTimes: (sampleFrames: number) => Promise<Float64Array>,
  options: {
    readonly sampleFrames?: number;
    readonly warmupFrames?: number;
  } = {},
): Promise<AnimationPerformanceSample> {
  const sampleFrames = positiveSafeInteger(options.sampleFrames ?? FRAME_TIME_SAMPLE_FRAMES, 'sample frame count');
  let cpuCapture: Promise<Float64Array> | undefined;
  const frameSample = await sampleFrameTimes(target, {
    onWarmupComplete: () => {
      cpuCapture = captureCpuTimes(sampleFrames);
    },
    sampleFrames,
    ...(options.warmupFrames === undefined ? {} : { warmupFrames: options.warmupFrames }),
  });
  if (cpuCapture === undefined) throw new Error('CPU frame capture did not start');
  const cpuTimesMs = await cpuCapture;
  if (cpuTimesMs.length !== sampleFrames) {
    throw new RangeError(`CPU frame capture returned ${String(cpuTimesMs.length)} of ${String(sampleFrames)} samples`);
  }
  return { ...frameSample, cpuTime: summarizeDurations(cpuTimesMs), cpuTimesMs };
}

/** Measures consecutive animation-frame timestamps after a fixed frame-count warm-up. */
export async function sampleFrameTimes(
  target: AnimationFrameTarget,
  options: {
    readonly onWarmupComplete?: () => void;
    readonly sampleFrames?: number;
    readonly warmupFrames?: number;
  } = {},
): Promise<FrameTimeSample> {
  const sampleFrames = positiveSafeInteger(options.sampleFrames ?? FRAME_TIME_SAMPLE_FRAMES, 'sample frame count');
  const warmupFrames = nonnegativeSafeInteger(options.warmupFrames ?? FRAME_TIME_WARMUP_FRAMES, 'warm-up frame count');
  const frameTimesMs = new Float64Array(sampleFrames);
  let frame = 0;
  let previousTimestamp: number | undefined;

  await new Promise<void>((resolve, reject) => {
    const measure: FrameRequestCallback = (timestamp) => {
      try {
        if (previousTimestamp !== undefined) {
          if (frame === warmupFrames) options.onWarmupComplete?.();
          if (frame >= warmupFrames) frameTimesMs[frame - warmupFrames] = timestamp - previousTimestamp;
          frame += 1;
        }
        previousTimestamp = timestamp;
        if (frame < warmupFrames + sampleFrames) target.requestAnimationFrame(measure);
        else resolve();
      } catch (error) {
        reject(error);
      }
    };
    target.requestAnimationFrame(measure);
  });

  return { frameTimesMs, summary: summarizeFrameTimes(frameTimesMs) };
}

export function summarizeFrameTimes(frameTimesMs: Float64Array): FrameTimeSummary {
  for (const frameTimeMs of frameTimesMs) {
    if (frameTimeMs <= 0) throw new RangeError('frame times must be positive');
  }
  const durations = summarizeDurations(frameTimesMs);
  return { ...durations, framesPerSecond: 1_000 / durations.meanMs };
}

export function summarizeDurations(durationsMs: Float64Array): DurationSummary {
  if (durationsMs.length === 0) throw new RangeError('duration sample must not be empty');
  let totalMs = 0;
  let maxMs = 0;
  for (const durationMs of durationsMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('durations must be nonnegative and finite');
    }
    totalMs += durationMs;
    maxMs = Math.max(maxMs, durationMs);
  }
  const sorted = durationsMs.slice().sort();
  const meanMs = totalMs / durationsMs.length;
  return {
    maxMs,
    meanMs,
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    sampleCount: durationsMs.length,
  };
}

function nearestRank(sorted: Float64Array, ratio: number): number {
  return sorted[Math.ceil(sorted.length * ratio) - 1]!;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}
