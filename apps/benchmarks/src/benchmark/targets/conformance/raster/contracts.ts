import type { BenchmarkControls, BenchmarkExecutionContext, BenchmarkInput, TargetRunOutput } from '../../../contracts';

export type RasterConformanceBackend = 'webgpu' | 'webgl2';
export type RasterConformanceTechnique = 'mtsdf' | 'slug';

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

/**
 * Technique-private resources stay in the selected target module. The target owns
 * this session's warm load, capture, and disposal lifecycle without owning a renderer.
 */
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
  readonly technique: RasterConformanceTechnique;
  createSession(backend: RasterConformanceBackend): Promise<RasterConformanceSession>;
}
