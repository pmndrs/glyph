import type { FontFeature } from '@pmndrs/glyph';
import {
  worldToLocalMatrix,
  type Decorations,
  type GlyphKey,
  type Glyphs,
  type ThreeGlyphMeasurement,
} from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

/** The committed Three text surface needed to animate an independently copied glyph branch. */
export interface TransitionableText {
  readonly parent: THREE.Object3D | null;
  readonly matrixWorld: THREE.Matrix4;
  visible: boolean;
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean, force?: boolean): void;
  measureGlyphs(): readonly ThreeGlyphMeasurement[] | undefined;
  breakApart(): readonly [Glyphs, Decorations | undefined];
}

/**
 * Paragraph inputs that decide which glyphs exist and in what visual order. Font size, layout width, anchor, and
 * device pixel ratio are deliberately absent: they move the same glyphs rather than replacing or reordering them.
 */
export interface ShapedTextIdentity {
  readonly fontFixture: string;
  readonly text: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
}

export type GlyphOriginPolicy = 'snap' | 'transition';

/**
 * Decides whether one committed reflow may interpolate glyph identities. `GlyphKey` survives movement but not a
 * reshape, so text, font, language, direction, or feature changes snap while geometry-only changes may transition.
 */
export function glyphOriginPolicy(
  previous: ShapedTextIdentity,
  next: ShapedTextIdentity,
  animatePresentation = true,
): GlyphOriginPolicy {
  if (!animatePresentation) return 'snap';
  if (previous.text !== next.text) return 'snap';
  if (previous.fontFixture !== next.fontFixture) return 'snap';
  if (previous.language !== next.language || previous.direction !== next.direction) return 'snap';
  return sameFontFeatures(previous.features, next.features) ? 'transition' : 'snap';
}

/** What one committed reflow did with glyph identities. */
export interface GlyphOriginPresentation {
  readonly transitioned: boolean;
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}

/** Reports a reflow with no interpolation. It never installs state on the live `Text`. */
export function snapGlyphOrigins(text: TransitionableText): GlyphOriginPresentation {
  return { transitioned: false, matchedGlyphs: 0, targetGlyphs: text.measureGlyphs()?.length ?? 0 };
}

export interface GlyphOriginSnapshotRecord {
  readonly key: GlyphKey;
  readonly worldMatrix: THREE.Matrix4;
}

/** Caller-owned world transforms copied from one committed paragraph. */
export type GlyphOriginSnapshot = readonly GlyphOriginSnapshotRecord[];

/** Copies committed world transforms without retaining renderer or planner resources. */
export function captureGlyphOrigins(text: TransitionableText): GlyphOriginSnapshot | undefined {
  const measurements = text.measureGlyphs();
  if (measurements === undefined) return undefined;
  text.updateWorldMatrix(true, false, true);
  const sourceMatrixWorld = text.matrixWorld.clone();
  return Object.freeze(
    measurements.map((measurement) =>
      Object.freeze({
        key: measurement.key,
        worldMatrix: sourceMatrixWorld.clone().multiply(measurement.originalMatrix),
      }),
    ),
  );
}

/** Captures origins only when the caller explicitly permits presentation interpolation. */
export function captureGlyphOriginsForPresentation(
  text: TransitionableText,
  previous: ShapedTextIdentity,
  next: ShapedTextIdentity,
  animatePresentation: boolean,
): GlyphOriginSnapshot | undefined {
  if (glyphOriginPolicy(previous, next, animatePresentation) === 'snap') return undefined;
  return captureGlyphOrigins(text);
}

/** Presentation-only motion on one independently owned `Glyphs` branch. */
export interface GlyphOriginTransition {
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
  readonly progress: number;
  setProgress(progress: number): void;
  finish(): void;
  dispose(): void;
}

interface MatrixTransition {
  readonly startPosition: THREE.Vector3;
  readonly startQuaternion: THREE.Quaternion;
  readonly startScale: THREE.Vector3;
  readonly targetPosition: THREE.Vector3;
  readonly targetQuaternion: THREE.Quaternion;
  readonly targetScale: THREE.Vector3;
}

/**
 * Copies the new committed draw into `Glyphs`, hides the live source, and interpolates full world matrices from the
 * prior committed transforms. Finishing or disposing releases the copy and restores the source visibility.
 */
export function createGlyphOriginTransition(
  text: TransitionableText,
  from: GlyphOriginSnapshot | undefined,
): GlyphOriginTransition {
  const parent = text.parent;
  if (parent === null) throw new TypeError('glyph-origin transition requires an attached text object');
  const [detached, decorations] = text.breakApart();
  parent.add(detached);
  if (decorations !== undefined) parent.add(decorations);
  const sourceWasVisible = text.visible;
  text.visible = false;
  detached.updateWorldMatrix(true, false, true);
  const detachedMatrixWorld = detached.matrixWorld.clone();

  const previous = new Map(from?.map((record) => [record.key, record.worldMatrix] as const));
  const transitions = new Array<MatrixTransition>(detached.count);
  let matchedGlyphs = 0;
  try {
    for (let index = 0; index < detached.count; index += 1) {
      const glyph = detached.glyphAt(index);
      const measurement = detached.measurements[index];
      if (glyph === undefined || measurement === undefined) {
        throw new Error(`detached glyph ${index} has no identity or measurement`);
      }
      const target = detachedMatrixWorld.clone().multiply(measurement.originalMatrix);
      const prior = previous.get(glyph.key);
      const start = prior ?? target;
      if (prior !== undefined) matchedGlyphs += 1;
      const startPosition = new THREE.Vector3();
      const startQuaternion = new THREE.Quaternion();
      const startScale = new THREE.Vector3();
      const targetPosition = new THREE.Vector3();
      const targetQuaternion = new THREE.Quaternion();
      const targetScale = new THREE.Vector3();
      start.decompose(startPosition, startQuaternion, startScale);
      target.decompose(targetPosition, targetQuaternion, targetScale);
      transitions[index] = {
        startPosition,
        startQuaternion,
        startScale,
        targetPosition,
        targetQuaternion,
        targetScale,
      };
    }
  } catch (error) {
    detached.dispose();
    decorations?.dispose();
    text.visible = sourceWasVisible;
    throw error;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const detachedWorldInverse = new THREE.Matrix4();
  let progress = 1;
  let disposed = false;
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    detached.dispose();
    decorations?.dispose();
    text.visible = sourceWasVisible;
  };
  const setProgress = (nextProgress: number): void => {
    if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 1) {
      throw new RangeError('glyph-origin transition progress must be in [0, 1]');
    }
    if (disposed) throw new DOMException('The glyph-origin transition is stale', 'AbortError');
    detached.updateWorldMatrix(true, false, true);
    detachedWorldInverse.copy(detached.matrixWorld).invert();
    for (let index = 0; index < transitions.length; index += 1) {
      const transition = transitions[index]!;
      position.lerpVectors(transition.startPosition, transition.targetPosition, nextProgress);
      quaternion.copy(transition.startQuaternion).slerp(transition.targetQuaternion, nextProgress);
      scale.lerpVectors(transition.startScale, transition.targetScale, nextProgress);
      matrix.compose(position, quaternion, scale);
      worldToLocalMatrix(detachedWorldInverse, matrix, matrix);
      detached.setMatrixAt(index, matrix);
    }
    progress = nextProgress;
  };
  return {
    matchedGlyphs,
    targetGlyphs: detached.count,
    get progress() {
      return progress;
    },
    setProgress,
    finish() {
      if (disposed) return;
      setProgress(1);
      cleanup();
    },
    dispose: cleanup,
  };
}

/** Duration the live technique scenes present a reflow over. */
export const GLYPH_ORIGIN_TRANSITION_MS = 110;

/** A transition advanced by the host frame clock. */
export interface FrameDrivenGlyphTransition {
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
  advance(timestamp: number): number;
  dispose(): void;
}

export function createFrameDrivenGlyphTransition(
  text: TransitionableText,
  from: GlyphOriginSnapshot | undefined,
  durationMs: number = GLYPH_ORIGIN_TRANSITION_MS,
): FrameDrivenGlyphTransition {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('glyph-origin transition duration must be positive');
  }
  const transition = createGlyphOriginTransition(text, from);
  transition.setProgress(0);
  let startedAt: number | undefined;
  return {
    matchedGlyphs: transition.matchedGlyphs,
    targetGlyphs: transition.targetGlyphs,
    advance(timestamp) {
      startedAt ??= timestamp;
      const linear = Math.min(1, Math.max(0, (timestamp - startedAt) / durationMs));
      if (linear === 1) {
        transition.finish();
        return 1;
      }
      const eased = linear * linear * (3 - 2 * linear);
      transition.setProgress(eased);
      return eased;
    },
    dispose() {
      transition.dispose();
    },
  };
}

/** Reports a reflow the scene chose to interpolate. */
export function transitionPresentation(transition: {
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}): GlyphOriginPresentation {
  return { transitioned: true, matchedGlyphs: transition.matchedGlyphs, targetGlyphs: transition.targetGlyphs };
}

function sameFontFeatures(previous: readonly FontFeature[], next: readonly FontFeature[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((feature, index) => {
    const other = next[index];
    return other !== undefined && feature.tag === other.tag && feature.value === other.value;
  });
}
