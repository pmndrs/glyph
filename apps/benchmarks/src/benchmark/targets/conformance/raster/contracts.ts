import type { BenchmarkControls, BenchmarkExecutionContext, BenchmarkInput, TargetRunOutput } from '../../../contracts';

export type RasterConformanceBackend = 'webgpu' | 'webgl2';
export type RasterConformanceFormatName = 'mtsdf' | 'slug';

/** The subset of a source-outline capture the conformance target publishes. */
export interface RasterSourceOutlineCapture {
  readonly candidate: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly physicalPpem: number;
  readonly meanAbsoluteError: number;
  readonly maximumError: number;
  readonly errorPixels: number;
  readonly renderSubmitMs: number;
}

/** Owns its session's warm load, capture, and disposal lifecycle; does not own a renderer. */
export interface RasterConformanceSession {
  load(input: BenchmarkInput, controls: BenchmarkControls, context?: BenchmarkExecutionContext): Promise<void>;
  captureSampling(
    input: BenchmarkInput,
    sampleIndex: number,
    controls: BenchmarkControls,
    context?: BenchmarkExecutionContext,
  ): Promise<TargetRunOutput>;
  captureSourceOutline(
    input: BenchmarkInput,
    controls: BenchmarkControls,
    context?: BenchmarkExecutionContext,
  ): Promise<RasterSourceOutlineCapture>;
  dispose(): Promise<void>;
}

export interface RasterConformanceAdapter {
  readonly format: RasterConformanceFormatName;
  createSession(backend: RasterConformanceBackend): Promise<RasterConformanceSession>;
}
