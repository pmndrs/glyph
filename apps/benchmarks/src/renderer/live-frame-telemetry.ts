const DEFAULT_CAPACITY = 240
const DEFAULT_REPORT_INTERVAL_MS = 250

export interface LiveFrameHistoryCursor {
  length: number
  nextIndex: number
}

export interface LiveFrameToken {
  readonly frameId: number
  readonly measureGpu: boolean
  readonly snapshot: LiveFrameTelemetrySnapshot | undefined
}

export interface LiveFrameTelemetrySnapshot {
  readonly frameCount: number
  readonly framesPerSecond: number
  readonly refreshRateHz: number
  readonly frameBudgetMs: number
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
  readonly submitHistoryCursor: LiveFrameHistoryCursor
  readonly fpsHistory: Float32Array
  readonly fpsHistoryLength: number
  readonly fpsHistoryNextIndex: number
  readonly fpsHistoryCursor: LiveFrameHistoryCursor
  readonly gpuHistory: Float32Array
  readonly gpuHistoryLength: number
  readonly gpuHistoryNextIndex: number
  readonly gpuHistoryCursor: LiveFrameHistoryCursor
}

export interface LiveFrameTelemetry {
  beginFrame(timestampMs: number): LiveFrameToken
  endFrame(token: LiveFrameToken, durationMs: number): LiveFrameTelemetrySnapshot | undefined
  recordGpu(frameId: number, durationMs: number): boolean
  discardGpu(frameId: number): boolean
}

interface PendingSample {
  readonly frameId: number
  readonly frameCount: number
  readonly framesPerSecond: number
  submitMs?: number
  gpuMs?: number
}

export function createLiveFrameTelemetry(options?: {
  readonly capacity?: number
  readonly gpuTimingSupported?: boolean
  readonly refreshRateHz?: number
  readonly reportIntervalMs?: number
}): LiveFrameTelemetry {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY
  const reportIntervalMs = options?.reportIntervalMs ?? DEFAULT_REPORT_INTERVAL_MS
  const gpuTimingSupported = options?.gpuTimingSupported ?? true
  const explicitRefreshRateHz = optionalPositive(options?.refreshRateHz, 'display refresh rate')
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
  const historyCursor: LiveFrameHistoryCursor = { length: 0, nextIndex: 0 }
  let frameCount = 0
  let reportedAt = performance.now()
  let reportedFrame = 0
  let pendingSample: PendingSample | undefined
  let readySample: PendingSample | undefined
  let latestSnapshot: LiveFrameTelemetrySnapshot | undefined
  let observedRefreshRateHz = 0

  const publishReadySample = (): LiveFrameTelemetrySnapshot | undefined => {
    const sample = readySample
    if (sample === undefined || sample.submitMs === undefined) return undefined
    if (gpuTimingSupported && sample.gpuMs === undefined) return undefined
    const index = historyCursor.nextIndex
    fpsHistory[index] = sample.framesPerSecond
    submitHistory[index] = sample.submitMs
    gpuHistory[index] = sample.gpuMs ?? Number.NaN
    historyCursor.nextIndex = (index + 1) % capacity
    historyCursor.length = Math.min(historyCursor.length + 1, capacity)
    observedRefreshRateHz = Math.max(observedRefreshRateHz, sample.framesPerSecond)
    readySample = undefined
    latestSnapshot = snapshot(
      sample,
      explicitRefreshRateHz ?? observedRefreshRateHz,
      historyCursor,
      submitHistory,
      submitQuantileScratch,
      fpsHistory,
      gpuHistory,
      gpuQuantileScratch,
      gpuTimingSupported,
    )
    return latestSnapshot
  }

  return {
    beginFrame(timestampMs) {
      if (!Number.isFinite(timestampMs)) throw new RangeError('frame timestamp must be finite')
      const published = publishReadySample()
      frameCount += 1
      const frameId = frameCount
      if (pendingSample !== undefined) {
        return { frameId, measureGpu: false, snapshot: published }
      }
      const elapsedMs = timestampMs - reportedAt
      if (elapsedMs < reportIntervalMs) {
        return { frameId, measureGpu: false, snapshot: published }
      }
      const framesPerSecond =
        elapsedMs <= 0 ? 0 : ((frameCount - reportedFrame) * 1_000) / elapsedMs
      pendingSample = { frameId, frameCount, framesPerSecond }
      reportedAt = timestampMs
      reportedFrame = frameCount
      return { frameId, measureGpu: gpuTimingSupported, snapshot: published }
    },
    endFrame(token, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('CPU submit duration must be finite and nonnegative')
      }
      const pending = pendingSample
      if (pending === undefined || pending.frameId !== token.frameId) return token.snapshot
      pending.submitMs = durationMs
      if (!gpuTimingSupported) {
        readySample = pending
        pendingSample = undefined
        return publishReadySample() ?? token.snapshot
      }
      return token.snapshot
    },
    recordGpu(frameId, durationMs) {
      if (!Number.isSafeInteger(frameId) || frameId <= 0) {
        throw new RangeError('GPU frame id must be a positive safe integer')
      }
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('GPU frame duration must be finite and nonnegative')
      }
      const pending = pendingSample
      if (pending === undefined || pending.frameId !== frameId) return false
      pending.gpuMs = durationMs
      readySample = pending
      pendingSample = undefined
      return true
    },
    discardGpu(frameId) {
      if (!Number.isSafeInteger(frameId) || frameId <= 0) {
        throw new RangeError('GPU frame id must be a positive safe integer')
      }
      if (pendingSample?.frameId !== frameId) return false
      pendingSample = undefined
      return true
    },
  }
}

function snapshot(
  sample: PendingSample,
  refreshRateHz: number,
  cursor: LiveFrameHistoryCursor,
  submitHistory: Float32Array,
  submitScratch: Float32Array,
  fpsHistory: Float32Array,
  gpuHistory: Float32Array,
  gpuScratch: Float32Array,
  gpuTimingSupported: boolean,
): LiveFrameTelemetrySnapshot {
  const length = cursor.length
  copyAndSort(submitHistory, submitScratch, length, cursor.nextIndex, false)
  copyAndSort(gpuHistory, gpuScratch, length, cursor.nextIndex, true)
  const gpuLength = gpuTimingSupported ? length : 0
  const normalizedRefreshRate = Math.max(Number.EPSILON, refreshRateHz)
  return {
    frameCount: sample.frameCount,
    framesPerSecond: sample.framesPerSecond,
    refreshRateHz: normalizedRefreshRate,
    frameBudgetMs: 1_000 / normalizedRefreshRate,
    medianSubmitMs: quantile(submitScratch, length, 0.5),
    p95SubmitMs: quantile(submitScratch, length, 0.95),
    minimumSubmitMs: historyMinimum(submitHistory, length, cursor.nextIndex, false),
    maximumSubmitMs: historyMaximum(submitHistory, length, cursor.nextIndex, false),
    minimumFramesPerSecond: historyMinimum(fpsHistory, length, cursor.nextIndex, false),
    maximumFramesPerSecond: historyMaximum(fpsHistory, length, cursor.nextIndex, false),
    gpuFrameMs: gpuTimingSupported ? sample.gpuMs : undefined,
    medianGpuMs: gpuLength === 0 ? undefined : quantile(gpuScratch, gpuLength, 0.5),
    p95GpuMs: gpuLength === 0 ? undefined : quantile(gpuScratch, gpuLength, 0.95),
    minimumGpuMs:
      gpuLength === 0 ? undefined : historyMinimum(gpuHistory, length, cursor.nextIndex, true),
    maximumGpuMs:
      gpuLength === 0 ? undefined : historyMaximum(gpuHistory, length, cursor.nextIndex, true),
    submitHistory,
    submitHistoryLength: length,
    submitHistoryNextIndex: cursor.nextIndex,
    submitHistoryCursor: cursor,
    fpsHistory,
    fpsHistoryLength: length,
    fpsHistoryNextIndex: cursor.nextIndex,
    fpsHistoryCursor: cursor,
    gpuHistory,
    gpuHistoryLength: gpuLength,
    gpuHistoryNextIndex: cursor.nextIndex,
    gpuHistoryCursor: cursor,
  }
}

function historyMinimum(
  history: Float32Array,
  length: number,
  nextIndex: number,
  skipNonfinite: boolean,
): number {
  let minimum = Number.POSITIVE_INFINITY
  forEachHistoryValue(history, length, nextIndex, (value) => {
    if (!skipNonfinite || Number.isFinite(value)) minimum = Math.min(minimum, value)
  })
  return minimum === Number.POSITIVE_INFINITY ? 0 : minimum
}

function historyMaximum(
  history: Float32Array,
  length: number,
  nextIndex: number,
  skipNonfinite: boolean,
): number {
  let maximum = Number.NEGATIVE_INFINITY
  forEachHistoryValue(history, length, nextIndex, (value) => {
    if (!skipNonfinite || Number.isFinite(value)) maximum = Math.max(maximum, value)
  })
  return maximum === Number.NEGATIVE_INFINITY ? 0 : maximum
}

function copyAndSort(
  source: Float32Array,
  target: Float32Array,
  length: number,
  nextIndex: number,
  skipNonfinite: boolean,
): void {
  let copied = 0
  forEachHistoryValue(source, length, nextIndex, (value) => {
    if (skipNonfinite && !Number.isFinite(value)) return
    target[copied] = value
    copied += 1
  })
  for (let index = copied; index < target.length; index += 1) {
    target[index] = Number.POSITIVE_INFINITY
  }
  target.sort()
}

function forEachHistoryValue(
  history: Float32Array,
  length: number,
  nextIndex: number,
  visit: (value: number) => void,
): void {
  const start = length === history.length ? nextIndex : 0
  for (let index = 0; index < length; index += 1) {
    visit(history[(start + index) % history.length] ?? Number.NaN)
  }
}

function quantile(sorted: Float32Array, length: number, fraction: number): number {
  if (length === 0) return 0
  const index = Math.min(length - 1, Math.ceil(length * fraction) - 1)
  return sorted[index] ?? 0
}

function optionalPositive(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`)
  return value
}
