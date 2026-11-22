import type { Node, NodeMaterial, Object3D, Scene } from 'three/webgpu';

import type {
  TslBitmapShaderOutput,
  TslDecorationShaderOutput,
  TslMsdfShaderOutput,
  TslSlugShaderOutput,
} from '../shaders/tsl/index.js';

/** Stable publication-root metadata supplied to every Three material factory. */
export interface ThreeRootContext {
  readonly name: string | undefined;
  readonly scene: Scene | undefined;
  /** Three object containing the renderer-owned meshes for this publication. */
  readonly renderObject: Object3D;
}

type ThreeMaterialRootContext = Readonly<{ root: ThreeRootContext }>;

/**
 * The two position nodes every built-in material context carries. Both are evaluated once per vertex and reach a
 * fragment node as their interpolated value, so either may be read from any node, in either stage, any number of
 * times. A displacement assigns `material.positionNode` from `position`; fragment reads still see the undisplaced value.
 */
type ThreeMaterialPositions = Readonly<{
  /**
   * Unanchored paragraph-local position in Three units, +X right and +Y up: the space of `Text.glyphs().inkBounds`
   * with its Y axis negated. Excludes the anchor offset, detached-glyph transforms, and the Text/ancestor transform,
   * so it tracks the paragraph identically in direct and indexed transform modes.
   */
  paragraphPosition: Node<'vec3'>;
  /**
   * Final draw-local position, the value the default material assigns to `material.positionNode`. Indexed transform
   * mode folds the Text/ancestor transform in; direct mode leaves it on the draw mesh's matrix, so the value differs
   * between modes for the same world-space glyph. Not comparable with paragraph or Text-local bounds.
   */
  position: Node<'vec3'>;
}>;

type ThreeDecorationMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'decoration';
    shader: TslDecorationShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions;

type ThreeBitmapMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.bitmap';
    shader: TslBitmapShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions;

type ThreeMsdfMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.msdf';
    shader: TslMsdfShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions;

type ThreeSlugMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.slug';
    shader: TslSlugShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions;

/** Custom Three rasters augment this map with their literal format key and exact material context. */
export interface ThreeTextMaterialContextMap {
  readonly decoration: ThreeDecorationMaterialContext;
  readonly 'pmndrs.bitmap': ThreeBitmapMaterialContext;
  readonly 'pmndrs.msdf': ThreeMsdfMaterialContext;
  readonly 'pmndrs.slug': ThreeSlugMaterialContext;
}

export type ThreeTextMaterialContext = ThreeTextMaterialContextMap[keyof ThreeTextMaterialContextMap];

export interface ThreeTextMaterial {
  create(context: ThreeTextMaterialContext): NodeMaterial;
}

/** Define one renderer-owned material factory carried through Rust as a numeric `materialId`. */
export function defineTextMaterial(create: ThreeTextMaterial['create']): ThreeTextMaterial {
  if (typeof create !== 'function') throw new TypeError('text material create must be a function');
  return Object.freeze({ create });
}
