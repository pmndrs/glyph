const DEFAULT_CAPACITY = 120
const DEFAULT_REPORT_INTERVAL_MS = 250

export interface LiveFrameTelemetrySnapshot {
  readonly frameCount: number
  readonly framesPerSecond: number
  readonly medianSubmitMs: number
  readonly p95SubmitMs: number
  readonly minimumSubmitMs: number
  readonly maximumSubmitMs: number
  readonly minimumFramesPerSecond: number
  readonly maximumFramesPerSecond: number
  readonly gpuFrameMs: number | undefined
  readonly medianGpuMs: number | undefined
  readonly p95GpuMs: number | undefined
  readonly minimumGpuMs: number | undefined
  readonly maximumGpuMs: number | undefined
  readonly submitHistory: Float32Array
  readonly submitHistoryLength: number
  readonly submitHistoryNextIndex: number
  readonly fpsHistory: Float32Array
  readonly fpsHistoryLength: number
  readonly fpsHistoryNextIndex: number
  readonly gpuHistory: Float32Array
  readonly gpuHistoryLength: number
  readonly gpuHistoryNextIndex: number
}

export interface LiveFrameTelemetry {
  recordGpu(durationMs: number): void
  recordSubmit(timestampMs: number, durationMs: number): LiveFrameTelemetrySnapshot | undefined
}

export function createLiveFrameTelemetry(options?: {
  readonly capacity?: number
  readonly reportIntervalMs?: number
}): LiveFrameTelemetry {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY
  const reportIntervalMs = options?.reportIntervalMs ?? DEFAULT_REPORT_INTERVAL_MS
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError('live telemetry capacity must be a positive safe integer')
  }
  if (!Number.isFinite(reportIntervalMs) || reportIntervalMs <= 0) {
    throw new RangeError('live telemetry report interval must be positive')
  }

  const submitHistory = new Float32Array(capacity)
  const submitQuantileScratch = new Float32Array(capacity)
  const fpsHistory = new Float32Array(capacity)
  const gpuHistory = new Float32Array(capacity)
  const gpuQuantileScratch = new Float32Array(capacity)
  let submitHistoryLength = 0
  let submitHistoryNextIndex = 0
  let fpsHistoryLength = 0
  let fpsHistoryNextIndex = 0
  let gpuHistoryLength = 0
  let gpuHistoryNextIndex = 0
  let gpuFrameMs: number | undefined
  let frameCount = 0
  let reportedAt = performance.now()
  let reportedFrame = 0

  return {
    recordGpu(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('GPU frame duration must be finite and nonnegative')
      }
      gpuFrameMs = durationMs
      gpuHistory[gpuHistoryNextIndex] = durationMs
      gpuHistoryNextIndex = (gpuHistoryNextIndex + 1) % capacity
      gpuHistoryLength = Math.min(gpuHistoryLength + 1, capacity)
    },
    recordSubmit(timestampMs, durationMs) {
      if (!Number.isFinite(timestampMs)) throw new RangeError('frame timestamp must be finite')
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('CPU submit duration must be finite and nonnegative')
      }
      submitHistory[submitHistoryNextIndex] = durationMs
      submitHistoryNextIndex = (submitHistoryNextIndex + 1) % capacity
      submitHistoryLength = Math.min(submitHistoryLength + 1, capacity)
      frameCount += 1
      const elapsedMs = timestampMs - reportedAt
      if (elapsedMs < reportIntervalMs) return undefined

      const framesPerSecond = elapsedMs <= 0 ? 0 : ((frameCount - reportedFrame) * 1000) / elapsedMs
      fpsHistory[fpsHistoryNextIndex] = framesPerSecond
      fpsHistoryNextIndex = (fpsHistoryNextIndex + 1) % capacity
      fpsHistoryLength = Math.min(fpsHistoryLength + 1, capacity)
      copyAndSort(submitHistory, submitQuantileScratch, submitHistoryLength)
      copyAndSort(gpuHistory, gpuQuantileScratch, gpuHistoryLength)
      reportedAt = timestampMs
      reportedFrame = frameCount

      return {
        frameCount,
        framesPerSecond,
        medianSubmitMs: quantile(submitQuantileScratch, submitHistoryLength, 0.5),
        p95SubmitMs: quantile(submitQuantileScratch, submitHistoryLength, 0.95),
        minimumSubmitMs: historyMinimum(submitHistory, submitHistoryLength),
        maximumSubmitMs: historyMaximum(submitHistory, submitHistoryLength),
        minimumFramesPerSecond: historyMinimum(fpsHistory, fpsHistoryLength),
        maximumFramesPerSecond: historyMaximum(fpsHistory, fpsHistoryLength),
        gpuFrameMs,
        medianGpuMs:
          gpuHistoryLength === 0 ? undefined : quantile(gpuQuantileScratch, gpuHistoryLength, 0.5),
        p95GpuMs:
          gpuHistoryLength === 0 ? undefined : quantile(gpuQuantileScratch, gpuHistoryLength, 0.95),
        minimumGpuMs:
          gpuHistoryLength === 0 ? undefined : historyMinimum(gpuHistory, gpuHistoryLength),
        maximumGpuMs:
          gpuHistoryLength === 0 ? undefined : historyMaximum(gpuHistory, gpuHistoryLength),
        submitHistory,
        submitHistoryLength,
        submitHistoryNextIndex,
        fpsHistory,
        fpsHistoryLength,
        fpsHistoryNextIndex,
        gpuHistory,
        gpuHistoryLength,
        gpuHistoryNextIndex,
      }
    },
  }
}

function historyMinimum(history: Float32Array, length: number): number {
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 0; index < length; index += 1) {
    minimum = Math.min(minimum, history[index] ?? minimum)
  }
  return length === 0 ? 0 : minimum
}

function historyMaximum(history: Float32Array, length: number): number {
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = 0; index < length; index += 1) {
    maximum = Math.max(maximum, history[index] ?? maximum)
  }
  return length === 0 ? 0 : maximum
}

function copyAndSort(source: Float32Array, target: Float32Array, length: number): void {
  target.set(source)
  for (let index = length; index < target.length; index += 1) {
    target[index] = Number.POSITIVE_INFINITY
  }
  target.sort()
}

function quantile(sorted: Float32Array, length: number, fraction: number): number {
  if (length === 0) return 0
  const index = Math.min(length - 1, Math.ceil(length * fraction) - 1)
  return sorted[index] ?? 0
}
