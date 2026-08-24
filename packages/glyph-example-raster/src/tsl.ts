import { add, min, mul, step, sub, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

import { glyphExampleShaderContract, type GlyphExampleShaderVariant } from './shader-contract.js';
import './portable.js';

export interface GlyphExampleTslShaderInput {
  readonly origin: Node<'vec2'>;
  readonly size: Node<'vec2'>;
  readonly color: Node<'vec4'>;
  readonly quadPosition: Node<'vec3'>;
  readonly quadUv: Node<'vec2'>;
  readonly transformPosition: (position: Node<'vec3'>) => Node<'vec3'>;
}

export interface GlyphExampleTslShaderOutput {
  readonly position: Node<'vec3'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

export const glyphExampleTslVariant: GlyphExampleShaderVariant = Object.freeze({
  language: 'tsl',
  techniqueId: glyphExampleShaderContract.techniqueId,
  geometry: glyphExampleShaderContract.geometry,
  buffers: glyphExampleShaderContract.buffers,
  resource: glyphExampleShaderContract.resource,
});

export function glyphExampleTslShader(input: GlyphExampleTslShaderInput): GlyphExampleTslShaderOutput {
  const edgeDistance = min(min(input.quadUv.x, sub(1, input.quadUv.x)), min(input.quadUv.y, sub(1, input.quadUv.y)));
  const position = vec3(
    add(input.origin.x, mul(input.quadPosition.x, input.size.x)),
    sub(0, add(input.origin.y, mul(input.quadPosition.y, input.size.y))),
    0,
  );
  return {
    position: input.transformPosition(position),
    color: input.color.rgb,
    opacity: mul(input.color.a, sub(1, step(0.08, edgeDistance))),
  };
}
