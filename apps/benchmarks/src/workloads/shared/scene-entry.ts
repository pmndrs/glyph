import type { Font, ParagraphLayoutSummary, RasterFormatMetadata } from '@pmndrs/glyph';
import { TextGroup, type Text, type ThreeRoot } from '@pmndrs/glyph/three';
import type * as THREE from 'three/webgpu';

/**
 * Comparison workloads are technique-generic by construction: the host resolves one concrete technique per lane and
 * hands every scene the same renderer-neutral metadata view, so a single `ComparisonWorkloadDefinition` can serve
 * Bitmap, MTSDF, and Slug without recovering format-specific decoded data.
 */
export type WorkloadFont = Font<RasterFormatMetadata>;
export type WorkloadText = Text<RasterFormatMetadata>;
export type WorkloadTextGroup = TextGroup;

export interface MutableSpanPaint {
  color: string;
  outline?: { color: string; width: number };
  shadow?: { color: string; offset: readonly [number, number] };
}

/** One retained span whose visual style the animation rewrites before republishing the whole span list. */
export interface MutablePaintSpan {
  readonly start: number;
  readonly end: number;
  readonly style: MutableSpanPaint;
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
  readonly offAxisSpans?: MutablePaintSpan[];
  readonly richTextCompanionFonts?: readonly [emphasis: WorkloadFont, foreign: WorkloadFont];
  lastWidth?: number;
  zoomLanguage?: string;
  zoomOpacity?: number;
  zoomMaximumScale?: number;
  zoomPhraseIndex?: number;
}

export interface WorkloadTextFactoryContext {
  readonly dpr: number;
  readonly font: WorkloadFont;
  readonly root: ThreeRoot;
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
  return text.measure();
}

/** Text style colors use CSS strings, while the comparison palettes stay authored as 24-bit hex. */
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
