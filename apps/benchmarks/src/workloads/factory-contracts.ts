import type { AnyRasterInput, RegisteredFont, Text, TextSpan } from '@pmndrs/text';
import type * as THREE from 'three/webgpu';

export interface MutablePaintSpan {
  color: number;
  readonly end: number;
  outline?: { color: number; width: number };
  shadow?: { color: number; offset: readonly [number, number] };
  readonly start: number;
}

/**
 * Shared host-facing entry data. Workload factories own construction; the host
 * only uses this structural view for scene attachment, disposal, and telemetry.
 */
export interface ComparisonWorkloadEntry {
  readonly node: THREE.Object3D;
  sourceText: string;
  readonly text: Text;
  readonly labelText?: Text;
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
  readonly paintUpdate?: { text: string; spans: readonly TextSpan[] };
  readonly offAxisSpans?: MutablePaintSpan[];
  readonly offAxisPaintUpdate?: { text: string; spans: readonly TextSpan[] };
  lastWidth?: number;
  readonly widthUpdate?: { width: number };
  zoomLanguage?: string;
  zoomOpacity?: number;
  readonly zoomOpacityUpdate?: { opacity: number };
  zoomMaximumScale?: number;
  zoomPhraseIndex?: number;
}

export interface WorkloadTextFactoryContext {
  readonly dpr: number;
  readonly font: RegisteredFont;
  readonly raster: AnyRasterInput;
}
