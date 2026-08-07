/** Three.js/TSL boundary over the host-agnostic vertex dilation in `core/dilate.js`. */
import type { Node } from 'three/webgpu';
import { d } from 'typegpu';
import * as t3 from '@typegpu/three';
import { coreValue } from './core-boundary.js';
import { slugDilate as dilate } from './core/dilate.js';

export interface SlugDilationNodes {
  readonly position: Node<'vec2'>;
  readonly textureCoordinate: Node<'vec2'>;
}

/** Expand one glyph-quad vertex by a half-pixel antialiasing footprint. */
export function slugDilate(
  position: Node<'vec2'>,
  outwardNormal: Node<'vec2'>,
  textureCoordinate: Node<'vec2'>,
  inverseScale: Node<'float'>,
  mvpRow0: Node<'vec4'>,
  mvpRow1: Node<'vec4'>,
  mvpRow3: Node<'vec4'>,
  viewport: Node<'vec2'>,
): SlugDilationNodes {
  const dilated: Node<'vec4'> = coreValue('vec4', 'slugDilated', () => {
    'use gpu';
    return dilate(
      t3.fromTSL(position, d.vec2f).$,
      t3.fromTSL(outwardNormal, d.vec2f).$,
      t3.fromTSL(textureCoordinate, d.vec2f).$,
      t3.fromTSL(inverseScale, d.f32).$,
      t3.fromTSL(mvpRow0, d.vec4f).$,
      t3.fromTSL(mvpRow1, d.vec4f).$,
      t3.fromTSL(mvpRow3, d.vec4f).$,
      t3.fromTSL(viewport, d.vec2f).$,
    );
  });

  return { position: dilated.xy, textureCoordinate: dilated.zw };
}
