import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import type { Node } from 'three/webgpu';

import { decorationPaint, decorationPosition } from '../typegpu/decoration-shader.js';

export interface TslDecorationInstanceNodes {
  readonly rect: Node<'vec4'>;
  readonly packed: Node<'uvec2'>;
}

export interface TslDecorationShaderOutput {
  readonly position: Node<'vec3'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/** Adapt Three nodes to the canonical TypeGPU decoration function. */
export function decorationShader(instance: TslDecorationInstanceNodes): TslDecorationShaderOutput {
  const position = t3.toTSL(() => {
    'use gpu';
    return decorationPosition(t3.fromTSL(instance.rect, d.vec4f).$, t3.positionLocal.$);
  }) as Node<'vec3'>;
  const paint = t3.toTSL(() => {
    'use gpu';
    return decorationPaint(t3.fromTSL(instance.packed, d.vec2u).$);
  }) as Node<'vec4'>;
  return {
    position,
    color: paint.rgb,
    opacity: paint.a,
  };
}
