import type { Node, NodeMaterial, Object3D, Scene } from 'three/webgpu';

import type {
  TslBitmapShaderOutput,
  TslDecorationShaderOutput,
  TslMsdfShaderOutput,
  TslSlugShaderOutput,
} from '../tsl.js';

/** Stable publication-root metadata supplied to every Three material factory. */
export interface ThreeRootContext {
  readonly name: string | undefined;
  readonly scene: Scene | undefined;
  readonly drawRoot: Object3D;
}

type ThreeMaterialRootContext = Readonly<{ root: ThreeRootContext }>;

type ThreeDecorationMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'decoration';
    shader: TslDecorationShaderOutput;
    position: Node<'vec3'>;
    createDefaultMaterial(): NodeMaterial;
  }>;

type ThreeBitmapMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.bitmap';
    shader: TslBitmapShaderOutput;
    /** Final renderer-local position including Codec-selected transform indirection. */
    position: Node<'vec3'>;
    createDefaultMaterial(): NodeMaterial;
  }>;

type ThreeMsdfMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.msdf';
    shader: TslMsdfShaderOutput;
    position: Node<'vec3'>;
    createDefaultMaterial(): NodeMaterial;
  }>;

type ThreeSlugMaterialContext = ThreeMaterialRootContext &
  Readonly<{
    kind: 'glyph';
    format: 'pmndrs.slug';
    shader: TslSlugShaderOutput;
    position: Node<'vec3'>;
    createDefaultMaterial(): NodeMaterial;
  }>;

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
