import type * as THREE from 'three/webgpu';

import type { RasterConformanceSpecimen, BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { RasterTechnique } from '../../benchmark/url-state';
import type { ComparisonWorkloadEntry, WorkloadFont } from '../shared/scene-entry';

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

/**
 * How the host parents a workload's Texts.
 *
 * `group` mounts them under one shared `TextGroup`, so every Text in the workload prepares and packs into a single
 * paragraph batch. `standalone` leaves each Text to bind its own implicit batch of one, which is what a lone
 * large-body paragraph already is; keeping that lane standalone also keeps its telemetry directly comparable to the
 * merged-v0 scene it replaces.
 */
export type ComparisonWorkloadBatching = 'group' | 'standalone';

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
  readonly font: WorkloadFont;
  readonly iconFont?: WorkloadFont;
  readonly iconScrollX: number;
  readonly iconScrollY: number;
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
  readonly batching: ComparisonWorkloadBatching;
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
