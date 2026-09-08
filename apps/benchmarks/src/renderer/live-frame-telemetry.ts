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

export interface LiveFrameTelemetryCaptureOptions {
  readonly cpuSampleCount: number;
  readonly gpuSampleCount: number;
  readonly signal?: AbortSignal;
}

export interface LiveFrameTelemetryCapture {
  /** The last frame already in flight before the capture began. */
  readonly startedAfterFrameId: number;
  /** Exact finite CPU durations collected after `startedAfterFrameId`. */
  readonly cpuMs: Float64Array;
  /** Exact finite GPU query completions whose source frames followed `startedAfterFrameId`. */
  readonly gpuMs: Float64Array;
}

interface LiveFrameTelemetryCaptureRequest {
  accepted: boolean;
  readonly options: LiveFrameTelemetryCaptureOptions;
  readonly resolve: (capture: LiveFrameTelemetryCapture) => void;
  readonly reject: (reason: unknown) => void;
}

const LIVE_FRAME_TELEMETRY_CAPTURE_EVENT = 'pmndrs-live-frame-telemetry-capture';

export interface LiveFrameTelemetry {
  readonly gpuTimingSupported: boolean;
  /** Starts a fresh scene-local sample window while preserving globally unique frame IDs. */
  reset(): void;
  /** Allocates and records an exact finite window only for an explicit benchmark capture. */
  capture(options: LiveFrameTelemetryCaptureOptions): Promise<LiveFrameTelemetryCapture>;
  beginFrame(timestampMs: number): number;
  endFrame(frameId: number, durationMs: number): LiveFrameTelemetrySnapshot | undefined;
  recordGpu(frameId: number, durationMs: number): boolean;
  discardGpu(frameId: number): boolean;
}

/** Requests an on-demand capture from the live telemetry instance bound to `target`. */
export function requestLiveFrameTelemetryCapture(
  target: EventTarget,
  options: LiveFrameTelemetryCaptureOptions,
): Promise<LiveFrameTelemetryCapture> {
  return new Promise((resolve, reject) => {
    const detail: LiveFrameTelemetryCaptureRequest = { accepted: false, options, resolve, reject };
    target.dispatchEvent(
      new CustomEvent<LiveFrameTelemetryCaptureRequest>(LIVE_FRAME_TELEMETRY_CAPTURE_EVENT, {
        cancelable: true,
        detail,
      }),
    );
    if (!detail.accepted) reject(new DOMException('no live telemetry capture target is available', 'NotFoundError'));
  });
}

/** Binds the explicit capture protocol without changing ordinary rolling telemetry publication. */
export function bindLiveFrameTelemetryCaptureRequests(target: EventTarget, telemetry: LiveFrameTelemetry): () => void {
  const requestCapture: EventListener = (event) => {
    const detail = captureRequestDetail(event);
    if (detail === undefined || detail.accepted) return;
    detail.accepted = true;
    event.preventDefault();
    try {
      void telemetry.capture(detail.options).then(detail.resolve, detail.reject);
    } catch (error) {
      detail.reject(error);
    }
  };
  target.addEventListener(LIVE_FRAME_TELEMETRY_CAPTURE_EVENT, requestCapture);
  return () => target.removeEventListener(LIVE_FRAME_TELEMETRY_CAPTURE_EVENT, requestCapture);
}

interface PendingLiveFrameTelemetryCapture extends LiveFrameTelemetryCapture {
  cpuLength: number;
  gpuLength: number;
  readonly resolve: (capture: LiveFrameTelemetryCapture) => void;
  readonly reject: (reason: unknown) => void;
  readonly unlinkAbort: () => void;
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

  let frameTimestampHistory = new Float64Array(capacity);
  const frameDurationHistory = new Float32Array(capacity).fill(Number.NaN);
  const frameDurationScratch = new Float32Array(capacity);
  const frameIds = new Array<number>(capacity).fill(0);
  const pendingGpuFrames = new Uint8Array(capacity);
  let submitHistory = new Float32Array(capacity).fill(Number.NaN);
  const reportFrames = new Uint8Array(capacity);
  const reportFramesPerSecond = new Float32Array(capacity);
  const submitQuantileScratch = new Float32Array(capacity);
  let fpsHistory = new Float32Array(capacity).fill(Number.NaN);
  let gpuHistory = new Float32Array(capacity).fill(Number.NaN);
  const gpuQuantileScratch = new Float32Array(capacity);
  let historyCursor: LiveFrameHistoryCursor = { length: 0, nextIndex: 0 };
  let frameCount = 0;
  let historyStartFrameId = 1;
  let lastFrameTimestamp: number | undefined;
  let smoothedFrameDurationMs: number | undefined;
  let reportedAt: number | undefined;
  let reportedFrame = 0;
  let latestSnapshot: LiveFrameTelemetrySnapshot | undefined;
  let latestGpuMs: number | undefined;
  let pendingCapture: PendingLiveFrameTelemetryCapture | undefined;

  const settleCapture = (): void => {
    const capture = pendingCapture;
    if (capture === undefined || capture.cpuLength < capture.cpuMs.length || capture.gpuLength < capture.gpuMs.length) {
      return;
    }
    pendingCapture = undefined;
    capture.unlinkAbort();
    capture.resolve({
      startedAfterFrameId: capture.startedAfterFrameId,
      cpuMs: capture.cpuMs,
      gpuMs: capture.gpuMs,
    });
  };

  const rejectCapture = (reason: unknown): void => {
    const capture = pendingCapture;
    if (capture === undefined) return;
    pendingCapture = undefined;
    capture.unlinkAbort();
    capture.reject(reason);
  };

  return {
    gpuTimingSupported,
    reset() {
      rejectCapture(new DOMException('live telemetry capture was reset', 'AbortError'));
      // Keep the previous published history immutable so the charts can bridge a scene change instead of flashing
      // empty. These four small rings are allocated only when benchmark identity changes, never on an ordinary frame.
      frameTimestampHistory = new Float64Array(capacity);
      frameDurationHistory.fill(Number.NaN);
      frameIds.fill(0);
      pendingGpuFrames.fill(0);
      submitHistory = new Float32Array(capacity).fill(Number.NaN);
      reportFrames.fill(0);
      reportFramesPerSecond.fill(0);
      fpsHistory = new Float32Array(capacity).fill(Number.NaN);
      gpuHistory = new Float32Array(capacity).fill(Number.NaN);
      historyCursor = { length: 0, nextIndex: 0 };
      historyStartFrameId = frameCount + 1;
      lastFrameTimestamp = undefined;
      smoothedFrameDurationMs = undefined;
      reportedAt = undefined;
      reportedFrame = frameCount;
      latestSnapshot = undefined;
      latestGpuMs = undefined;
    },
    capture(captureOptions) {
      const cpuSampleCount = nonnegativeSafeInteger(captureOptions.cpuSampleCount, 'CPU capture sample count');
      const gpuSampleCount = nonnegativeSafeInteger(captureOptions.gpuSampleCount, 'GPU capture sample count');
      if (cpuSampleCount === 0 && gpuSampleCount === 0) {
        throw new RangeError('live telemetry capture must request at least one sample');
      }
      if (gpuSampleCount > 0 && !gpuTimingSupported) {
        throw new DOMException('GPU timing is unavailable', 'NotSupportedError');
      }
      if (pendingCapture !== undefined) {
        throw new DOMException('a live telemetry capture is already active', 'InvalidStateError');
      }
      captureOptions.signal?.throwIfAborted();
      return new Promise<LiveFrameTelemetryCapture>((resolve, reject) => {
        const abort = (): void => rejectCapture(captureOptions.signal?.reason ?? captureAbortedError());
        const unlinkAbort = (): void => captureOptions.signal?.removeEventListener('abort', abort);
        pendingCapture = {
          startedAfterFrameId: frameCount,
          cpuMs: new Float64Array(cpuSampleCount),
          gpuMs: new Float64Array(gpuSampleCount),
          cpuLength: 0,
          gpuLength: 0,
          resolve,
          reject,
          unlinkAbort,
        };
        captureOptions.signal?.addEventListener('abort', abort, { once: true });
        settleCapture();
      });
    },
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
      const historyIndex = frameHistoryIndex(frameIds, frameId, historyStartFrameId);
      if (historyIndex === undefined) return undefined;
      submitHistory[historyIndex] = durationMs;
      const capture = pendingCapture;
      if (capture !== undefined && frameId > capture.startedAfterFrameId && capture.cpuLength < capture.cpuMs.length) {
        capture.cpuMs[capture.cpuLength] = durationMs;
        capture.cpuLength += 1;
        settleCapture();
      }
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
      const capture = pendingCapture;
      if (
        capture !== undefined &&
        frameId > capture.startedAfterFrameId &&
        frameId <= frameCount &&
        capture.gpuLength < capture.gpuMs.length
      ) {
        capture.gpuMs[capture.gpuLength] = durationMs;
        capture.gpuLength += 1;
        settleCapture();
      }
      const historyIndex = frameHistoryIndex(frameIds, frameId, historyStartFrameId);
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
      const historyIndex = frameHistoryIndex(frameIds, frameId, historyStartFrameId);
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
  const start = historyStart(length, nextIndex, history.length);
  for (let index = 0; index < length; index += 1) {
    const value = history[(start + index) % history.length] ?? Number.NaN;
    if (Number.isFinite(value)) minimum = Math.min(minimum, value);
  }
  return minimum === Number.POSITIVE_INFINITY ? 0 : minimum;
}

function historyMaximum(history: Float32Array, length: number, nextIndex: number): number {
  let maximum = Number.NEGATIVE_INFINITY;
  const start = historyStart(length, nextIndex, history.length);
  for (let index = 0; index < length; index += 1) {
    const value = history[(start + index) % history.length] ?? Number.NaN;
    if (Number.isFinite(value)) maximum = Math.max(maximum, value);
  }
  return maximum === Number.NEGATIVE_INFINITY ? 0 : maximum;
}

function copyFiniteHistory(source: Float32Array, target: Float32Array, length: number, nextIndex: number): number {
  let copied = 0;
  const start = historyStart(length, nextIndex, source.length);
  for (let index = 0; index < length; index += 1) {
    const value = source[(start + index) % source.length] ?? Number.NaN;
    if (!Number.isFinite(value)) continue;
    target[copied] = value;
    copied += 1;
  }
  return copied;
}

function historyStart(length: number, nextIndex: number, capacity: number): number {
  return (nextIndex - length + capacity) % capacity;
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

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function captureAbortedError(): DOMException {
  return new DOMException('live telemetry capture was aborted', 'AbortError');
}

function captureRequestDetail(event: Event): LiveFrameTelemetryCaptureRequest | undefined {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  if (
    !('accepted' in detail) ||
    typeof detail.accepted !== 'boolean' ||
    !('options' in detail) ||
    !('resolve' in detail) ||
    typeof detail.resolve !== 'function' ||
    !('reject' in detail) ||
    typeof detail.reject !== 'function'
  ) {
    return undefined;
  }
  return detail as LiveFrameTelemetryCaptureRequest;
}

function assertGpuFrameId(frameId: number): void {
  if (!Number.isSafeInteger(frameId) || frameId <= 0) {
    throw new RangeError('GPU frame id must be a positive safe integer');
  }
}

function frameHistoryIndex(
  frameIds: readonly number[],
  frameId: number,
  historyStartFrameId: number,
): number | undefined {
  if (frameId < historyStartFrameId) return undefined;
  const index = (frameId - historyStartFrameId) % frameIds.length;
  return frameIds[index] === frameId ? index : undefined;
}
