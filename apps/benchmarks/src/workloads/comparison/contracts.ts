import type { AnyRasterInput, RegisteredFont } from '@pmndrs/text';
import type * as THREE from 'three/webgpu';

import type { RasterConformanceSpecimen, BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { RasterTechnique } from '../../benchmark/url-state';
import type { ComparisonWorkloadEntry } from '../shared/scene-entry';

/** The comparison workloads that share the retained benchmark render host. */
export type ComparisonWorkloadId =
  | 'text-ladder'
  | 'zoom-text'
  | 'icon-grid'
  | 'off-axis-3d'
  | 'dynamic-layout'
  | 'paragraph-stress'
  | 'paint-effects';

export type IconGridView = 'alternate' | 'origin';

export interface ComparisonWorkloadConfiguration {
  readonly amount: number;
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly fontSize: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly iconGridView?: IconGridView;
  readonly layoutWidthRatio: number;
  readonly paintOpacity: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokeWidth: number;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly textLadderExitEnabled: boolean;
  readonly workload: ComparisonWorkloadId;
}

export type ComparisonWorkloadUpdateKind = 'rebuild' | 'retained';
export type WorkloadCameraKind = 'orthographic' | 'perspective';

/** App-private inputs made available to a workload's layout hook. */
export interface ComparisonWorkloadLayoutContext {
  readonly configuration: ComparisonWorkloadConfiguration;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}

/** App-private inputs made available to a workload's scene factory. */
export interface ComparisonWorkloadCreateContext extends ComparisonWorkloadLayoutContext {
  readonly animationElapsedMs: number;
  readonly dpr: number;
  readonly font: RegisteredFont;
  readonly iconFont?: { readonly font: RegisteredFont; readonly raster: AnyRasterInput };
  readonly iconScrollX: number;
  readonly iconScrollY: number;
  readonly raster: AnyRasterInput;
  readonly technique: RasterTechnique;
  readonly textLadderSpecimen?: RasterConformanceSpecimen;
}

/** Reused host-owned scratch storage exposed to workload frame hooks without per-frame allocation. */
export interface ComparisonWorkloadAnimationScratch {
  readonly dynamicWidths: Float64Array;
  readonly textLadderPosition: { x: number; y: number };
  readonly zoomText: { phraseIndex: number; phraseRevision: number; progress: number };
}

/**
 * App-private workload policy and scene hooks. The retained host remains responsible for renderer,
 * scene activation, cancellation, telemetry, and transactional Text publication.
 */
export interface ComparisonWorkloadDefinition {
  readonly cameraKind: WorkloadCameraKind;
  readonly contentWidth: 'none' | { readonly maximumWidth?: number; readonly multiplier?: number };
  readonly id: ComparisonWorkloadId;
  readonly suspendsIconWindow: boolean;
  create(context: ComparisonWorkloadCreateContext): readonly ComparisonWorkloadEntry[];
  layout(entries: readonly ComparisonWorkloadEntry[], context: ComparisonWorkloadLayoutContext): void;
  animate(
    entries: readonly ComparisonWorkloadEntry[],
    configuration: ComparisonWorkloadConfiguration,
    elapsedMs: number,
    viewportWidth: number,
    viewportHeight: number,
    scene: THREE.Scene,
    scratch: ComparisonWorkloadAnimationScratch,
    onError: (error: unknown) => void,
    onReflow: (duration: number) => void,
  ): void;
  applyRetainedConfiguration(
    entries: readonly ComparisonWorkloadEntry[],
    configuration: ComparisonWorkloadConfiguration,
    technique: RasterTechnique,
  ): void;
  updateKind(
    previous: ComparisonWorkloadConfiguration,
    next: ComparisonWorkloadConfiguration,
  ): ComparisonWorkloadUpdateKind;
}
