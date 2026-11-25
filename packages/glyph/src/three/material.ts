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

/**
 * What a glyph material context says about the glyph a vertex or fragment belongs to. Both are constant across a
 * glyph and, like the position nodes, may be read from any node of either stage. A decoration context carries the
 * same two names for the glyphs its rectangle runs under ({@link ThreeMaterialDecoratedGlyphs}).
 */
type ThreeMaterialGlyph = Readonly<{
  /**
   * The glyph's index in its text's layout order: the index `Text.glyphs()` reports it at, counting every glyph of
   * the text across lines, fonts and formats, blank ones included (so drawn indices have gaps). Glyphs of a
   * right-to-left run count in the order they are drawn, left to right, and a ligature is one glyph. It is a
   * position, not an identity: an edit before a glyph shifts it. On a `Glyphs` it is the index the glyph had in its
   * source `Text` when `split()` ran.
   */
  glyphIndex: Node<'uint'>;
  /**
   * The glyph's pen origin on its baseline, in the space and units of `paragraphPosition`:
   * `(glyphs().x[glyphIndex], -glyphs().y[glyphIndex], 0)`. `paragraphPosition.sub(glyphOrigin)` is a vertex's offset
   * from its own glyph, the pivot `Glyphs.setMatrixAt` turns a glyph about. On a `Glyphs` it is the origin captured by
   * `split()`.
   */
  glyphOrigin: Node<'vec3'>;
}>;

/**
 * What a decoration material context says about the glyphs its rectangle (an underline, overline or line-through of
 * one run on one line) runs under, so that an expression written for glyphs also moves the line drawn under them.
 * A rectangle has four corners: it follows its first and last glyph and stays straight between them.
 */
type ThreeMaterialDecoratedGlyphs = Readonly<{
  /**
   * The layout index under this point of the rectangle, as a float: exactly the first decorated glyph's `glyphIndex`
   * at the rectangle's inline start, exactly the last one's at its inline end, and linear between. A line's glyphs
   * are indexed in the order they are drawn, so the value only grows left to right, through right-to-left text
   * too, and counts the blanks the line runs under. It is a float where a glyph's is a `uint`: wrap it in `float()`
   * to share an expression, and in `uint()` (which truncates) for integer arithmetic or a table lookup. A rectangle
   * is cut at every line break and font change, so each has its own range.
   */
  glyphIndex: Node<'float'>;
  /**
   * The `glyphOrigin` of the first decorated glyph: the rectangle's inline start on the line's baseline. Constant
   * across the rectangle, so a displacement taken from it moves the rectangle as one piece. A glyph raised off the
   * baseline or moved by mark positioning has its own origin; the rectangle keeps the baseline.
   */
  glyphOrigin: Node<'vec3'>;
}>;

type ThreeDecorationMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'decoration';
    shader: TslDecorationShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions &
  ThreeMaterialDecoratedGlyphs;

type ThreeBitmapMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.bitmap';
    shader: TslBitmapShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions &
  ThreeMaterialGlyph;

type ThreeMsdfMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.msdf';
    shader: TslMsdfShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions &
  ThreeMaterialGlyph;

type ThreeSlugMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.slug';
    shader: TslSlugShaderOutput;
    createDefaultMaterial(): NodeMaterial;
  }> &
  ThreeMaterialPositions &
  ThreeMaterialGlyph;

/** Custom Three rasters augment this map with their literal format key and exact material context. */
export interface ThreeTextMaterialContextMap {
  readonly decoration: ThreeDecorationMaterialContext;
  readonly 'pmndrs.bitmap': ThreeBitmapMaterialContext;
  readonly 'pmndrs.msdf': ThreeMsdfMaterialContext;
  readonly 'pmndrs.slug': ThreeSlugMaterialContext;
}

export type ThreeTextMaterialContext = ThreeTextMaterialContextMap[keyof ThreeTextMaterialContextMap];

/** A material factory and how Three frustum-culls the draws it renders; created by {@link defineTextMaterial}. */
export interface ThreeTextMaterial {
  create(context: ThreeTextMaterialContext): NodeMaterial;
  /**
   * Whether draws using this material are frustum culled. `true` (default) tests the bound Glyph computes from the
   * records each draw places, grown by {@link boundsPadding}; `false` draws them whatever the camera sees, for a
   * vertex stage whose reach no padding states.
   */
  readonly frustumCulled: boolean;
  /**
   * The furthest this material's vertex stage moves any vertex along any axis, in the units of the context's
   * `position`: the displacement added to `position` before it is assigned to `material.positionNode`. Glyph grows
   * each draw's culling bound by this much on every side, so the bound holds in direct and indexed transform mode
   * alike. Default `0`, exact for a material that leaves `positionNode` to the default. A material that moves a
   * vertex further than it declares can have that vertex culled while it is on screen.
   */
  readonly boundsPadding: number;
}

/**
 * Define one renderer-owned material factory carried through Rust as a numeric `materialId`. A factory that displaces
 * vertices declares how far with `boundsPadding`, or `frustumCulled: false` when no distance bounds it.
 */
export function defineTextMaterial(
  create: ThreeTextMaterial['create'],
  options: Readonly<Partial<Pick<ThreeTextMaterial, 'frustumCulled' | 'boundsPadding'>>> = {},
): ThreeTextMaterial {
  if (typeof create !== 'function') throw new TypeError('text material create must be a function');
  if (typeof options !== 'object' || options === null) throw new TypeError('text material options must be an object');
  const { frustumCulled = true, boundsPadding = 0 } = options;
  if (typeof frustumCulled !== 'boolean') throw new TypeError('text material frustumCulled must be a boolean');
  if (typeof boundsPadding !== 'number' || !(boundsPadding >= 0) || !Number.isFinite(boundsPadding)) {
    throw new RangeError('text material boundsPadding must be a finite number >= 0');
  }
  return Object.freeze({ create, frustumCulled, boundsPadding });
}
