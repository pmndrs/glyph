const DEFAULT_CAPACITY = 1_024;
const DEFAULT_REPORT_INTERVAL_MS = 250;
const FPS_SMOOTHING_TIME_CONSTANT_MS = 250;
const MINIMUM_REFRESH_ESTIMATE_SAMPLES = 8;
const REFRESH_PERIOD_QUANTILE = 0.25;

export interface LiveFrameHistoryCursor {
  length: number;
  nextIndex: number;
}

export interface LiveFrameTelemetrySnapshot {
  readonly frameCount: number;
  readonly framesPerSecond: number;
  readonly refreshRateHz: number;
  readonly frameBudgetMs: number;
  readonly medianSubmitMs: number;
  readonly p95SubmitMs: number;
  readonly minimumSubmitMs: number;
  readonly maximumSubmitMs: number;
  readonly minimumFramesPerSecond: number;
  readonly maximumFramesPerSecond: number;
  readonly gpuFrameMs: number | undefined;
  readonly medianGpuMs: number | undefined;
  readonly p95GpuMs: number | undefined;
  readonly minimumGpuMs: number | undefined;
  readonly maximumGpuMs: number | undefined;
  readonly frameTimestampHistory: Float64Array;
  readonly submitHistory: Float32Array;
  readonly submitHistoryLength: number;
  readonly submitHistoryNextIndex: number;
  readonly submitHistoryCursor: LiveFrameHistoryCursor;
  readonly fpsHistory: Float32Array;
  readonly fpsHistoryLength: number;
  readonly fpsHistoryNextIndex: number;
  readonly fpsHistoryCursor: LiveFrameHistoryCursor;
  readonly gpuHistory: Float32Array;
  readonly gpuHistoryLength: number;
  readonly gpuHistoryNextIndex: number;
  readonly gpuHistoryCursor: LiveFrameHistoryCursor;
}

export interface LiveFrameTelemetry {
  readonly gpuTimingSupported: boolean;
  beginFrame(timestampMs: number): number;
  endFrame(frameId: number, durationMs: number): LiveFrameTelemetrySnapshot | undefined;
  recordGpu(frameId: number, durationMs: number): boolean;
  discardGpu(frameId: number): boolean;
}

export function createLiveFrameTelemetry(options?: {
  readonly capacity?: number;
  readonly gpuTimingSupported?: boolean;
  readonly refreshRateHz?: number;
  readonly reportIntervalMs?: number;
}): LiveFrameTelemetry {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY;
  const reportIntervalMs = options?.reportIntervalMs ?? DEFAULT_REPORT_INTERVAL_MS;
  const gpuTimingSupported = options?.gpuTimingSupported ?? true;
  const explicitRefreshRateHz = optionalPositive(options?.refreshRateHz, 'display refresh rate');
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError('live telemetry capacity must be a positive safe integer');
  }
  if (!Number.isFinite(reportIntervalMs) || reportIntervalMs <= 0) {
    throw new RangeError('live telemetry report interval must be positive');
  }

  const frameTimestampHistory = new Float64Array(capacity);
  const frameDurationHistory = new Float32Array(capacity).fill(Number.NaN);
  const frameDurationScratch = new Float32Array(capacity);
  const frameIds = new Array<number>(capacity).fill(0);
  const pendingGpuFrames = new Uint8Array(capacity);
  const submitHistory = new Float32Array(capacity).fill(Number.NaN);
  const reportFrames = new Uint8Array(capacity);
  const reportFramesPerSecond = new Float32Array(capacity);
  const submitQuantileScratch = new Float32Array(capacity);
  const fpsHistory = new Float32Array(capacity).fill(Number.NaN);
  const gpuHistory = new Float32Array(capacity).fill(Number.NaN);
  const gpuQuantileScratch = new Float32Array(capacity);
  const historyCursor: LiveFrameHistoryCursor = { length: 0, nextIndex: 0 };
  let frameCount = 0;
  let lastFrameTimestamp: number | undefined;
  let smoothedFrameDurationMs: number | undefined;
  let reportedAt: number | undefined;
  let reportedFrame = 0;
  let latestSnapshot: LiveFrameTelemetrySnapshot | undefined;
  let latestGpuMs: number | undefined;

  return {
    gpuTimingSupported,
    beginFrame(timestampMs) {
      if (!Number.isFinite(timestampMs)) throw new RangeError('frame timestamp must be finite');
      frameCount += 1;
      const frameId = frameCount;
      const historyIndex = historyCursor.nextIndex;
      const overwrittenFrameId = frameIds[historyIndex] ?? 0;
      if (overwrittenFrameId !== 0) {
        pendingGpuFrames[historyIndex] = 0;
      }

      const frameDurationMs =
        lastFrameTimestamp === undefined || timestampMs <= lastFrameTimestamp
          ? Number.NaN
          : timestampMs - lastFrameTimestamp;
      if (Number.isFinite(frameDurationMs)) {
        const smoothingAlpha = 1 - Math.exp(-frameDurationMs / FPS_SMOOTHING_TIME_CONSTANT_MS);
        smoothedFrameDurationMs =
          smoothedFrameDurationMs === undefined
            ? frameDurationMs
            : smoothedFrameDurationMs + smoothingAlpha * (frameDurationMs - smoothedFrameDurationMs);
      }
      const smoothedFps = smoothedFrameDurationMs === undefined ? Number.NaN : 1_000 / smoothedFrameDurationMs;
      frameTimestampHistory[historyIndex] = timestampMs;
      frameDurationHistory[historyIndex] = frameDurationMs;
      frameIds[historyIndex] = frameId;
      fpsHistory[historyIndex] = smoothedFps;
      submitHistory[historyIndex] = Number.NaN;
      gpuHistory[historyIndex] = latestGpuMs ?? Number.NaN;
      pendingGpuFrames[historyIndex] = gpuTimingSupported ? 1 : 0;
      historyCursor.nextIndex = (historyIndex + 1) % capacity;
      historyCursor.length = Math.min(historyCursor.length + 1, capacity);
      lastFrameTimestamp = timestampMs;

      const elapsedMs = reportedAt === undefined ? 0 : timestampMs - reportedAt;
      const report = reportedAt === undefined || elapsedMs >= reportIntervalMs;
      const framesPerSecond =
        reportedAt === undefined || elapsedMs <= 0 ? 0 : ((frameCount - reportedFrame) * 1_000) / elapsedMs;
      if (report) {
        reportedAt = timestampMs;
        reportedFrame = frameCount;
      }
      reportFrames[historyIndex] = report ? 1 : 0;
      reportFramesPerSecond[historyIndex] = framesPerSecond;
      return frameId;
    },
    endFrame(frameId, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('CPU frame duration must be finite and nonnegative');
      }
      assertGpuFrameId(frameId);
      const historyIndex = frameHistoryIndex(frameIds, frameId);
      if (historyIndex === undefined) return undefined;
      submitHistory[historyIndex] = durationMs;
      if (reportFrames[historyIndex] !== 1) return undefined;
      const refreshRateHz =
        explicitRefreshRateHz ??
        estimateRefreshRateHz(
          frameDurationHistory,
          frameDurationScratch,
          historyCursor.length,
          historyCursor.nextIndex,
        );
      latestSnapshot = snapshot({
        cursor: historyCursor,
        frameCount,
        frameTimestampHistory,
        framesPerSecond: reportFramesPerSecond[historyIndex] || refreshRateHz,
        fpsHistory,
        gpuHistory,
        gpuQuantileScratch,
        gpuTimingSupported,
        latestGpuMs,
        refreshRateHz,
        submitHistory,
        submitQuantileScratch,
      });
      return latestSnapshot;
    },
    recordGpu(frameId, durationMs) {
      assertGpuFrameId(frameId);
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('GPU frame duration must be finite and nonnegative');
      }
      const historyIndex = frameHistoryIndex(frameIds, frameId);
      if (historyIndex === undefined) return false;
      for (let pendingIndex = 0; pendingIndex < capacity; pendingIndex += 1) {
        if (pendingGpuFrames[pendingIndex] !== 1) continue;
        const pendingFrameId = frameIds[pendingIndex] ?? 0;
        if (pendingFrameId === 0) continue;
        gpuHistory[pendingIndex] = durationMs;
        if (pendingFrameId <= frameId) pendingGpuFrames[pendingIndex] = 0;
      }
      latestGpuMs = durationMs;
      return true;
    },
    discardGpu(frameId) {
      assertGpuFrameId(frameId);
      const historyIndex = frameHistoryIndex(frameIds, frameId);
      if (historyIndex === undefined) return false;
      pendingGpuFrames[historyIndex] = 0;
      return true;
    },
  };
}

function estimateRefreshRateHz(
  frameDurations: Float32Array,
  scratch: Float32Array,
  length: number,
  nextIndex: number,
): number {
  const sampleCount = copyFiniteHistory(frameDurations, scratch, length, nextIndex);
  if (sampleCount < MINIMUM_REFRESH_ESTIMATE_SAMPLES) return 60;
  const refreshPeriodMs = quantile(scratch, sampleCount, REFRESH_PERIOD_QUANTILE);
  return refreshPeriodMs > 0 ? 1_000 / refreshPeriodMs : 60;
}

function snapshot(options: {
  readonly cursor: LiveFrameHistoryCursor;
  readonly frameCount: number;
  readonly frameTimestampHistory: Float64Array;
  readonly framesPerSecond: number;
  readonly fpsHistory: Float32Array;
  readonly gpuHistory: Float32Array;
  readonly gpuQuantileScratch: Float32Array;
  readonly gpuTimingSupported: boolean;
  readonly latestGpuMs: number | undefined;
  readonly refreshRateHz: number;
  readonly submitHistory: Float32Array;
  readonly submitQuantileScratch: Float32Array;
}): LiveFrameTelemetrySnapshot {
  const {
    cursor,
    frameCount,
    frameTimestampHistory,
    framesPerSecond,
    fpsHistory,
    gpuHistory,
    gpuQuantileScratch,
    gpuTimingSupported,
    latestGpuMs,
    refreshRateHz,
    submitHistory,
    submitQuantileScratch,
  } = options;
  const length = cursor.length;
  const submitLength = copyFiniteHistory(submitHistory, submitQuantileScratch, length, cursor.nextIndex);
  const gpuLength = gpuTimingSupported
    ? copyFiniteHistory(gpuHistory, gpuQuantileScratch, length, cursor.nextIndex)
    : 0;
  const normalizedRefreshRate = Math.max(Number.EPSILON, refreshRateHz);
  return {
    frameCount,
    framesPerSecond,
    refreshRateHz: normalizedRefreshRate,
    frameBudgetMs: 1_000 / normalizedRefreshRate,
    medianSubmitMs: quantile(submitQuantileScratch, submitLength, 0.5),
    p95SubmitMs: quantile(submitQuantileScratch, submitLength, 0.95),
    minimumSubmitMs: historyMinimum(submitHistory, length, cursor.nextIndex),
    maximumSubmitMs: historyMaximum(submitHistory, length, cursor.nextIndex),
    minimumFramesPerSecond: historyMinimum(fpsHistory, length, cursor.nextIndex),
    maximumFramesPerSecond: historyMaximum(fpsHistory, length, cursor.nextIndex),
    gpuFrameMs: gpuTimingSupported ? latestGpuMs : undefined,
    medianGpuMs: gpuLength === 0 ? undefined : quantile(gpuQuantileScratch, gpuLength, 0.5),
    p95GpuMs: gpuLength === 0 ? undefined : quantile(gpuQuantileScratch, gpuLength, 0.95),
    minimumGpuMs: gpuLength === 0 ? undefined : historyMinimum(gpuHistory, length, cursor.nextIndex),
    maximumGpuMs: gpuLength === 0 ? undefined : historyMaximum(gpuHistory, length, cursor.nextIndex),
    frameTimestampHistory,
    submitHistory,
    submitHistoryLength: length,
    submitHistoryNextIndex: cursor.nextIndex,
    submitHistoryCursor: cursor,
    fpsHistory,
    fpsHistoryLength: length,
    fpsHistoryNextIndex: cursor.nextIndex,
    fpsHistoryCursor: cursor,
    gpuHistory,
    gpuHistoryLength: gpuTimingSupported ? length : 0,
    gpuHistoryNextIndex: cursor.nextIndex,
    gpuHistoryCursor: cursor,
  };
}

function historyMinimum(history: Float32Array, length: number, nextIndex: number): number {
  let minimum = Number.POSITIVE_INFINITY;
  const start = length === history.length ? nextIndex : 0;
  for (let index = 0; index < length; index += 1) {
    const value = history[(start + index) % history.length] ?? Number.NaN;
    if (Number.isFinite(value)) minimum = Math.min(minimum, value);
  }
  return minimum === Number.POSITIVE_INFINITY ? 0 : minimum;
}

function historyMaximum(history: Float32Array, length: number, nextIndex: number): number {
  let maximum = Number.NEGATIVE_INFINITY;
  const start = length === history.length ? nextIndex : 0;
  for (let index = 0; index < length; index += 1) {
    const value = history[(start + index) % history.length] ?? Number.NaN;
    if (Number.isFinite(value)) maximum = Math.max(maximum, value);
  }
  return maximum === Number.NEGATIVE_INFINITY ? 0 : maximum;
}

function copyFiniteHistory(source: Float32Array, target: Float32Array, length: number, nextIndex: number): number {
  let copied = 0;
  const start = length === source.length ? nextIndex : 0;
  for (let index = 0; index < length; index += 1) {
    const value = source[(start + index) % source.length] ?? Number.NaN;
    if (!Number.isFinite(value)) continue;
    target[copied] = value;
    copied += 1;
  }
  return copied;
}

/** Selects the nearest-rank quantile in place without sorting or allocating a prefix view. */
function quantile(values: Float32Array, length: number, fraction: number): number {
  if (length === 0) return 0;
  const selectedIndex = Math.min(length - 1, Math.ceil(length * fraction) - 1);
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const pivot = values[(left + right) >>> 1] ?? 0;
    let lower = left;
    let upper = right;
    while (lower <= upper) {
      while ((values[lower] ?? 0) < pivot) lower += 1;
      while ((values[upper] ?? 0) > pivot) upper -= 1;
      if (lower > upper) break;
      const value = values[lower] ?? 0;
      values[lower] = values[upper] ?? 0;
      values[upper] = value;
      lower += 1;
      upper -= 1;
    }
    if (selectedIndex <= upper) right = upper;
    else if (selectedIndex >= lower) left = lower;
    else break;
  }
  return values[selectedIndex] ?? 0;
}

function optionalPositive(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function assertGpuFrameId(frameId: number): void {
  if (!Number.isSafeInteger(frameId) || frameId <= 0) {
    throw new RangeError('GPU frame id must be a positive safe integer');
  }
}

function frameHistoryIndex(frameIds: readonly number[], frameId: number): number | undefined {
  const index = (frameId - 1) % frameIds.length;
  return frameIds[index] === frameId ? index : undefined;
}
