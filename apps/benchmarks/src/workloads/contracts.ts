import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';

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
 * Per-workload policy only. The retained host remains responsible for renderer,
 * scene activation, cancellation, telemetry, and transactional Text publication.
 */
export interface ComparisonWorkloadDefinition {
  readonly cameraKind: WorkloadCameraKind;
  readonly contentWidth: 'none' | { readonly maximumWidth?: number; readonly multiplier?: number };
  readonly id: ComparisonWorkloadId;
  readonly suspendsIconWindow: boolean;
  updateKind(
    previous: ComparisonWorkloadConfiguration,
    next: ComparisonWorkloadConfiguration,
  ): ComparisonWorkloadUpdateKind;
}
