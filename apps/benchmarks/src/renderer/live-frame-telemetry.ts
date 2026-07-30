const DEFAULT_CAPACITY = 1_024;
const DEFAULT_REPORT_INTERVAL_MS = 250;
const FPS_SMOOTHING_TIME_CONSTANT_MS = 250;

export interface LiveFrameHistoryCursor {
  length: number;
  nextIndex: number;
}

export interface LiveFrameToken {
  readonly frameId: number;
  readonly historyIndex: number;
  readonly measureGpu: boolean;
  readonly report: boolean;
  readonly framesPerSecond: number;
  readonly snapshot: LiveFrameTelemetrySnapshot | undefined;
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
  beginFrame(timestampMs: number): LiveFrameToken;
  endFrame(token: LiveFrameToken, durationMs: number): LiveFrameTelemetrySnapshot | undefined;
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
  const frameIds = new Array<number>(capacity).fill(0);
  const frameSlots = new Map<number, number>();
  const pendingGpuFrames = new Set<number>();
  const submitHistory = new Float32Array(capacity).fill(Number.NaN);
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
  let observedRefreshRateHz = 0;

  return {
    beginFrame(timestampMs) {
      if (!Number.isFinite(timestampMs)) throw new RangeError('frame timestamp must be finite');
      frameCount += 1;
      const frameId = frameCount;
      const historyIndex = historyCursor.nextIndex;
      const overwrittenFrameId = frameIds[historyIndex] ?? 0;
      if (overwrittenFrameId !== 0) {
        frameSlots.delete(overwrittenFrameId);
        pendingGpuFrames.delete(overwrittenFrameId);
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
      frameIds[historyIndex] = frameId;
      frameSlots.set(frameId, historyIndex);
      fpsHistory[historyIndex] = smoothedFps;
      submitHistory[historyIndex] = Number.NaN;
      gpuHistory[historyIndex] = latestGpuMs ?? Number.NaN;
      if (gpuTimingSupported) pendingGpuFrames.add(frameId);
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
      if (Number.isFinite(frameDurationMs)) {
        observedRefreshRateHz = Math.max(observedRefreshRateHz, 1_000 / frameDurationMs);
      }
      return {
        frameId,
        framesPerSecond,
        historyIndex,
        measureGpu: gpuTimingSupported,
        report,
        snapshot: latestSnapshot,
      };
    },
    endFrame(token, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('CPU frame duration must be finite and nonnegative');
      }
      if (frameSlots.get(token.frameId) !== token.historyIndex) return token.snapshot;
      submitHistory[token.historyIndex] = durationMs;
      if (!token.report) return token.snapshot;
      const refreshRateHz = explicitRefreshRateHz ?? (observedRefreshRateHz || 60);
      latestSnapshot = snapshot({
        cursor: historyCursor,
        frameCount,
        frameTimestampHistory,
        framesPerSecond: token.framesPerSecond || refreshRateHz,
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
      const historyIndex = frameSlots.get(frameId);
      if (historyIndex === undefined) return false;
      for (const pendingFrameId of pendingGpuFrames) {
        const pendingIndex = frameSlots.get(pendingFrameId);
        if (pendingIndex !== undefined) gpuHistory[pendingIndex] = durationMs;
        if (pendingFrameId <= frameId) pendingGpuFrames.delete(pendingFrameId);
      }
      latestGpuMs = durationMs;
      return true;
    },
    discardGpu(frameId) {
      assertGpuFrameId(frameId);
      const historyIndex = frameSlots.get(frameId);
      if (historyIndex === undefined) return false;
      return true;
    },
  };
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
  const submitLength = copyAndSort(submitHistory, submitQuantileScratch, length, cursor.nextIndex);
  const gpuLength = gpuTimingSupported ? copyAndSort(gpuHistory, gpuQuantileScratch, length, cursor.nextIndex) : 0;
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
  forEachHistoryValue(history, length, nextIndex, (value) => {
    if (Number.isFinite(value)) minimum = Math.min(minimum, value);
  });
  return minimum === Number.POSITIVE_INFINITY ? 0 : minimum;
}

function historyMaximum(history: Float32Array, length: number, nextIndex: number): number {
  let maximum = Number.NEGATIVE_INFINITY;
  forEachHistoryValue(history, length, nextIndex, (value) => {
    if (Number.isFinite(value)) maximum = Math.max(maximum, value);
  });
  return maximum === Number.NEGATIVE_INFINITY ? 0 : maximum;
}

function copyAndSort(source: Float32Array, target: Float32Array, length: number, nextIndex: number): number {
  let copied = 0;
  forEachHistoryValue(source, length, nextIndex, (value) => {
    if (!Number.isFinite(value)) return;
    target[copied] = value;
    copied += 1;
  });
  target.subarray(0, copied).sort();
  return copied;
}

function forEachHistoryValue(
  history: Float32Array,
  length: number,
  nextIndex: number,
  visit: (value: number) => void,
): void {
  const start = length === history.length ? nextIndex : 0;
  for (let index = 0; index < length; index += 1) {
    visit(history[(start + index) % history.length] ?? Number.NaN);
  }
}

function quantile(sorted: Float32Array, length: number, fraction: number): number {
  if (length === 0) return 0;
  const index = Math.min(length - 1, Math.ceil(length * fraction) - 1);
  return sorted[index] ?? 0;
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
