import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import type { Node } from 'three/webgpu';

import { slugDilate as dilate, slugDilateMatrix as dilateMatrix } from '../../typegpu/slug-shaders/core/dilate.js';

export interface SlugDilationNodes {
  readonly position: Node<'vec2'>;
  readonly textureCoordinate: Node<'vec2'>;
}

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
  return splitDilation(
    t3.toTSL(() => {
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
    }) as Node<'vec4'>,
  );
}

export function slugDilateMatrix(
  position: Node<'vec2'>,
  outwardNormal: Node<'vec2'>,
  textureCoordinate: Node<'vec2'>,
  inverseScale: Node<'float'>,
  modelViewProjection: Node<'mat4'>,
  viewport: Node<'vec2'>,
): SlugDilationNodes {
  return splitDilation(
    t3.toTSL(() => {
      'use gpu';
      return dilateMatrix(
        t3.fromTSL(position, d.vec2f).$,
        t3.fromTSL(outwardNormal, d.vec2f).$,
        t3.fromTSL(textureCoordinate, d.vec2f).$,
        t3.fromTSL(inverseScale, d.f32).$,
        t3.fromTSL(modelViewProjection, d.mat4x4f).$,
        t3.fromTSL(viewport, d.vec2f).$,
      );
    }) as Node<'vec4'>,
  );
}

function splitDilation(dilated: Node<'vec4'>): SlugDilationNodes {
  return { position: dilated.xy, textureCoordinate: dilated.zw };
}
