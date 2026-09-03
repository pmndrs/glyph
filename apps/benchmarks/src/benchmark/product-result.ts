import type { BitmapTextLiveStats } from '../techniques/bitmap/persistent-scene';
import type { MtsdfTextLiveStats } from '../techniques/mtsdf/persistent-scene';
import type { SlugTextLiveStats } from '../techniques/slug/persistent-scene';
import type { BenchmarkEnvironment } from './contracts';
import type { BenchmarkFontFixture } from './font-fixtures';
import type { GraphicsBackend, RasterFormatName } from './url-state';

export type CapturedBitmapTextLiveStats = Omit<
  BitmapTextLiveStats,
  | 'frameTimestampHistory'
  | 'submitHistory'
  | 'submitHistoryLength'
  | 'submitHistoryNextIndex'
  | 'submitHistoryCursor'
  | 'fpsHistory'
  | 'fpsHistoryLength'
  | 'fpsHistoryNextIndex'
  | 'fpsHistoryCursor'
  | 'gpuHistory'
  | 'gpuHistoryLength'
  | 'gpuHistoryNextIndex'
  | 'gpuHistoryCursor'
> & {
  readonly submitHistory: readonly number[];
  readonly fpsHistory: readonly number[];
  readonly gpuHistory: readonly number[];
};

export type CapturedMtsdfTextLiveStats = Omit<
  MtsdfTextLiveStats,
  | 'frameTimestampHistory'
  | 'submitHistory'
  | 'submitHistoryLength'
  | 'submitHistoryNextIndex'
  | 'submitHistoryCursor'
  | 'fpsHistory'
  | 'fpsHistoryLength'
  | 'fpsHistoryNextIndex'
  | 'fpsHistoryCursor'
  | 'gpuHistory'
  | 'gpuHistoryLength'
  | 'gpuHistoryNextIndex'
  | 'gpuHistoryCursor'
> & {
  readonly submitHistory: readonly number[];
  readonly fpsHistory: readonly number[];
  readonly gpuHistory: readonly number[];
};

export type CapturedSlugTextLiveStats = Omit<
  SlugTextLiveStats,
  | 'frameTimestampHistory'
  | 'submitHistory'
  | 'submitHistoryLength'
  | 'submitHistoryNextIndex'
  | 'submitHistoryCursor'
  | 'fpsHistory'
  | 'fpsHistoryLength'
  | 'fpsHistoryNextIndex'
  | 'fpsHistoryCursor'
  | 'gpuHistory'
  | 'gpuHistoryLength'
  | 'gpuHistoryNextIndex'
  | 'gpuHistoryCursor'
> & {
  readonly submitHistory: readonly number[];
  readonly fpsHistory: readonly number[];
  readonly gpuHistory: readonly number[];
};

export type CapturedLiveTextStats =
  | CapturedBitmapTextLiveStats
  | CapturedMtsdfTextLiveStats
  | CapturedSlugTextLiveStats;

export interface LiveBenchmarkCapture {
  readonly kind: 'live-benchmark';
  readonly schemaVersion: 0;
  readonly capturedAt: string;
  readonly technique: RasterFormatName;
  readonly backend: GraphicsBackend;
  readonly workload: string;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly labelFontFixture?: BenchmarkFontFixture | undefined;
  readonly environment: BenchmarkEnvironment;
  readonly stats: CapturedLiveTextStats;
}

export function captureLiveTextStats(stats: BitmapTextLiveStats): CapturedBitmapTextLiveStats;
export function captureLiveTextStats(stats: MtsdfTextLiveStats): CapturedMtsdfTextLiveStats;
export function captureLiveTextStats(stats: SlugTextLiveStats): CapturedSlugTextLiveStats;
export function captureLiveTextStats(
  stats: BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats,
): CapturedLiveTextStats;
export function captureLiveTextStats(
  stats: BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats,
): CapturedLiveTextStats {
  const {
    submitHistory,
    submitHistoryLength: _submitHistoryLength,
    submitHistoryNextIndex: _submitHistoryNextIndex,
    submitHistoryCursor,
    fpsHistory,
    fpsHistoryLength: _fpsHistoryLength,
    fpsHistoryNextIndex: _fpsHistoryNextIndex,
    fpsHistoryCursor,
    gpuHistory,
    gpuHistoryLength: _gpuHistoryLength,
    gpuHistoryNextIndex: _gpuHistoryNextIndex,
    gpuHistoryCursor,
    frameTimestampHistory: _frameTimestampHistory,
    ...scalars
  } = stats;
  const capturedSubmitHistory = snapshotCircularSeries(
    submitHistory,
    submitHistoryCursor.length,
    submitHistoryCursor.nextIndex,
  );
  const capturedFpsHistory = snapshotCircularSeries(
    fpsHistory,
    fpsHistoryCursor.length,
    fpsHistoryCursor.nextIndex,
  ).filter(Number.isFinite);
  const capturedGpuHistory = snapshotCircularSeries(
    gpuHistory,
    gpuHistoryCursor.length,
    gpuHistoryCursor.nextIndex,
  ).filter(Number.isFinite);
  return {
    ...scalars,
    medianSubmitMs: capturedPercentile(capturedSubmitHistory, 0.5),
    p95SubmitMs: capturedPercentile(capturedSubmitHistory, 0.95),
    minimumSubmitMs: capturedMinimum(capturedSubmitHistory),
    maximumSubmitMs: capturedMaximum(capturedSubmitHistory),
    minimumFramesPerSecond: capturedMinimum(capturedFpsHistory),
    maximumFramesPerSecond: capturedMaximum(capturedFpsHistory),
    gpuFrameMs: capturedGpuHistory.at(-1),
    medianGpuMs: capturedOptionalPercentile(capturedGpuHistory, 0.5),
    p95GpuMs: capturedOptionalPercentile(capturedGpuHistory, 0.95),
    minimumGpuMs: capturedOptionalMinimum(capturedGpuHistory),
    maximumGpuMs: capturedOptionalMaximum(capturedGpuHistory),
    submitHistory: capturedSubmitHistory,
    fpsHistory: capturedFpsHistory,
    gpuHistory: capturedGpuHistory,
  };
}

export function snapshotCircularSeries(values: Float32Array, length: number, nextIndex: number): number[] {
  const snapshot = new Array<number>(length);
  const start = length === values.length ? nextIndex : 0;
  for (let index = 0; index < length; index += 1) {
    snapshot[index] = values[(start + index) % values.length] ?? 0;
  }
  return snapshot;
}

function capturedPercentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function capturedOptionalPercentile(values: readonly number[], fraction: number): number | undefined {
  return values.length === 0 ? undefined : capturedPercentile(values, fraction);
}

function capturedMinimum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function capturedMaximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function capturedOptionalMinimum(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : capturedMinimum(values);
}

function capturedOptionalMaximum(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : capturedMaximum(values);
}
