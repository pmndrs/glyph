import type { AnyRasterTechnique, Font, ParagraphLayoutSummary } from '@pmndrs/glyph';
import { TextGroup, type Text } from '@pmndrs/glyph/three';
import type * as THREE from 'three/webgpu';

/**
 * Comparison workloads are technique-generic by construction: the host resolves one concrete technique per lane and
 * hands every scene the same erased identity, so a single `ComparisonWorkloadDefinition` can serve Bitmap, MTSDF, and
 * Slug without threading a type parameter through the registry.
 */
export type WorkloadFont = Font<AnyRasterTechnique>;
export type WorkloadText = Text<AnyRasterTechnique>;
export type WorkloadTextGroup = TextGroup;

export interface MutableSpanPaint {
  color: string;
  outline?: { color: string; width: number };
  shadow?: { color: string; offset: readonly [number, number] };
}

/** One retained span whose paint the animation rewrites in place before republishing the whole span list. */
export interface MutablePaintSpan {
  readonly start: number;
  readonly end: number;
  readonly paint: MutableSpanPaint;
}

/** The retained `{ text, spans }` payload an animated workload republishes through `Text.set`. */
export interface RetainedSpanUpdate {
  readonly text: string;
  readonly spans: readonly MutablePaintSpan[];
}

/**
 * Shared host-facing entry data. Workload factories own construction; the host
 * only uses this structural view for scene attachment, disposal, and telemetry.
 */
export interface ComparisonWorkloadEntry {
  readonly node: THREE.Object3D;
  sourceText: string;
  readonly text: WorkloadText;
  readonly labelText?: WorkloadText;
  readonly bounds?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>;
  readonly role: 'primary' | 'secondary';
  virtualIconIndex?: number;
  disposed?: boolean;
  readonly alignment?: 'start' | 'center' | 'end';
  readonly animationPhase?: number;
  lastPaintFrame?: number;
  paintPhase?: number;
  paintRevision?: number;
  lastPaintUpdateMs?: number;
  paintOutlineWidth?: number;
  paintShadowOffset?: readonly [number, number];
  readonly paintSpans?: MutablePaintSpan[];
  readonly paintUpdate?: RetainedSpanUpdate;
  readonly offAxisSpans?: MutablePaintSpan[];
  readonly offAxisPaintUpdate?: RetainedSpanUpdate;
  lastWidth?: number;
  zoomLanguage?: string;
  zoomOpacity?: number;
  zoomMaximumScale?: number;
  zoomPhraseIndex?: number;
}

export interface WorkloadTextFactoryContext {
  readonly dpr: number;
  readonly font: WorkloadFont;
}

/**
 * Commits every pending Text edit beneath `root` and reports the first failure.
 *
 * Target-v1 has no per-Text readiness promise. A `TextGroup` — and a standalone `Text` that has a parent — reconciles,
 * shapes, lays out, and packs synchronously inside `updateMatrixWorld`, so this call is exactly the point at which an
 * explicit retained-Rust measurement can observe the committed revision and `error` becomes meaningful.
 */
export function publishWorkloadTexts(root: THREE.Object3D, entries: readonly ComparisonWorkloadEntry[]): void {
  root.updateMatrixWorld(true);
  if (root instanceof TextGroup && root.error !== undefined) throw root.error;
  for (const entry of entries) {
    const error = entry.text.error ?? entry.labelText?.error;
    if (error !== undefined) throw error;
  }
}

/** Explicitly queries the aggregate metrics committed by the Rust Text lifecycle before scene positioning. */
export function committedTextMetrics(text: WorkloadText): ParagraphLayoutSummary {
  return text.layout();
}

/** Target-v1 paint takes CSS colors, while the comparison palettes stay authored as 24-bit hex. */
export function paintColor(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xff_ff_ff) {
    throw new RangeError('workload paint color must be a 24-bit integer');
  }
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Width is always an exact constraint: `at-most` resolves the line box to the measured text rather than the requested
 * measure, which silently collapses centre and end alignment onto the start edge.
 */
export function exactWidth(size: number): { readonly mode: 'exact'; readonly size: number } {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('workload content width must be positive');
  return { mode: 'exact', size };
}
