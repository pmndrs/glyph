import type { BitmapTextLiveStats } from '../renderer/bitmap-text'
import type { MtsdfTextLiveStats } from '../renderer/mtsdf-text'
import type { BenchmarkEnvironment } from './contracts'
import type { BenchmarkFontFixture } from './font-fixtures'
import type { GraphicsBackend, RasterTechnique } from './url-state'

export type CapturedBitmapTextLiveStats = Omit<
  BitmapTextLiveStats,
  | 'submitHistory'
  | 'submitHistoryLength'
  | 'submitHistoryNextIndex'
  | 'fpsHistory'
  | 'fpsHistoryLength'
  | 'fpsHistoryNextIndex'
  | 'gpuHistory'
  | 'gpuHistoryLength'
  | 'gpuHistoryNextIndex'
> & {
  readonly submitHistory: readonly number[]
  readonly fpsHistory: readonly number[]
  readonly gpuHistory: readonly number[]
}

export type CapturedMtsdfTextLiveStats = Omit<
  MtsdfTextLiveStats,
  | 'submitHistory'
  | 'submitHistoryLength'
  | 'submitHistoryNextIndex'
  | 'fpsHistory'
  | 'fpsHistoryLength'
  | 'fpsHistoryNextIndex'
  | 'gpuHistory'
  | 'gpuHistoryLength'
  | 'gpuHistoryNextIndex'
> & {
  readonly submitHistory: readonly number[]
  readonly fpsHistory: readonly number[]
  readonly gpuHistory: readonly number[]
}

export type CapturedLiveTextStats = CapturedBitmapTextLiveStats | CapturedMtsdfTextLiveStats

export interface LiveBenchmarkCapture {
  readonly kind: 'live-benchmark'
  readonly schemaVersion: 0
  readonly capturedAt: string
  readonly technique: RasterTechnique
  readonly backend: GraphicsBackend
  readonly workload: string
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly environment: BenchmarkEnvironment
  readonly stats: CapturedLiveTextStats
}

export function captureBitmapTextStats(stats: BitmapTextLiveStats): CapturedBitmapTextLiveStats {
  return captureLiveTextStats(stats)
}

export function captureLiveTextStats(stats: BitmapTextLiveStats): CapturedBitmapTextLiveStats
export function captureLiveTextStats(stats: MtsdfTextLiveStats): CapturedMtsdfTextLiveStats
export function captureLiveTextStats(
  stats: BitmapTextLiveStats | MtsdfTextLiveStats,
): CapturedLiveTextStats
export function captureLiveTextStats(
  stats: BitmapTextLiveStats | MtsdfTextLiveStats,
): CapturedLiveTextStats {
  const {
    submitHistory,
    submitHistoryLength,
    submitHistoryNextIndex,
    fpsHistory,
    fpsHistoryLength,
    fpsHistoryNextIndex,
    gpuHistory,
    gpuHistoryLength,
    gpuHistoryNextIndex,
    ...scalars
  } = stats
  return {
    ...scalars,
    submitHistory: snapshotCircularSeries(
      submitHistory,
      submitHistoryLength,
      submitHistoryNextIndex,
    ),
    fpsHistory: snapshotCircularSeries(fpsHistory, fpsHistoryLength, fpsHistoryNextIndex),
    gpuHistory: snapshotCircularSeries(gpuHistory, gpuHistoryLength, gpuHistoryNextIndex),
  }
}

export function snapshotCircularSeries(
  values: Float32Array,
  length: number,
  nextIndex: number,
): number[] {
  const snapshot = new Array<number>(length)
  const start = length === values.length ? nextIndex : 0
  for (let index = 0; index < length; index += 1) {
    snapshot[index] = values[(start + index) % values.length] ?? 0
  }
  return snapshot
}
