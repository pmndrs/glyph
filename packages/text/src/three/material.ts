import type { Node, NodeMaterial } from 'three/webgpu';

import type { TslBitmapShaderOutput, TslMsdfShaderOutput, TslSlugShaderOutput } from '../tsl.js';

export type ThreeTextMaterialContext =
  | Readonly<{
      technique: 'pmndrs.bitmap';
      shader: TslBitmapShaderOutput;
      /** Final renderer-local position including policy-selected transform indirection. */
      position: Node<'vec3'>;
      createDefaultMaterial(): NodeMaterial;
    }>
  | Readonly<{
      technique: 'pmndrs.msdf';
      shader: TslMsdfShaderOutput;
      position: Node<'vec3'>;
      createDefaultMaterial(): NodeMaterial;
    }>
  | Readonly<{
      technique: 'pmndrs.slug';
      shader: TslSlugShaderOutput;
      position: Node<'vec3'>;
      createDefaultMaterial(): NodeMaterial;
    }>;

export interface ThreeTextMaterial {
  create(context: ThreeTextMaterialContext): NodeMaterial;
}

/** Define one renderer-owned material factory carried through Rust as a numeric `materialId`. */
export function defineTextMaterial(create: ThreeTextMaterial['create']): ThreeTextMaterial {
  if (typeof create !== 'function') throw new TypeError('text material create must be a function');
  return Object.freeze({ create });
}
