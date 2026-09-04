import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

import {
  bitmapAtlasUv,
  bitmapPaintCoverageOpacity,
  bitmapPageTexelCoordinate,
  bitmapQuadPosition,
  snapClipAxis,
} from '../typegpu/bitmap-shader.js';

const modelViewProjection = TSL.modelViewProjection as Node<'vec4'>;

export interface TslBitmapInstanceNodes {
  readonly origin: Node<'vec2'>;
  readonly size: Node<'vec2'>;
  readonly uvOrigin: Node<'vec2'>;
  readonly uvSize: Node<'vec2'>;
  readonly color: Node<'vec4'>;
  readonly pageIndex: Node<'uint'>;
}

export interface TslBitmapShaderResources {
  readonly page: Texture;
}

export interface TslBitmapShaderOptions {
  readonly pixelSnapping?: boolean;
}

export interface TslBitmapShaderOutput {
  readonly position: Node<'vec3'>;
  readonly clipPosition: Node<'vec4'>;
  readonly atlasUv: Node<'vec2'>;
  readonly coverage: Node<'float'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/** Adapt the canonical TypeGPU Bitmap functions to Three's node graph. */
export function bitmapShader(
  instance: TslBitmapInstanceNodes,
  resources: TslBitmapShaderResources,
  options: TslBitmapShaderOptions = {},
): TslBitmapShaderOutput {
  const position = t3.toTSL(() => {
    'use gpu';
    return bitmapQuadPosition(
      t3.fromTSL(instance.origin, d.vec2f).$,
      t3.fromTSL(instance.size, d.vec2f).$,
      t3.positionLocal.$.xy,
    );
  }) as Node<'vec3'>;
  const atlasUv = t3.toTSL(() => {
    'use gpu';
    return bitmapAtlasUv(t3.fromTSL(instance.uvOrigin, d.vec2f).$, t3.fromTSL(instance.uvSize, d.vec2f).$, t3.uv().$);
  }) as Node<'vec2'>;
  // Three models textureSize as uvec2, while GLSL reports an array texture as ivec3. Converting the expression to
  // vec2 normalizes both backend shapes and discards GLSL's layer count before it crosses the TypeGPU bridge.
  const reportedDimensions = TSL.textureSize(TSL.textureLoad(resources.page), TSL.int(0)) as unknown as Node<'uvec2'>;
  const pageDimensions = TSL.vec2(reportedDimensions);
  const texelCoordinate = t3.toTSL(() => {
    'use gpu';
    return bitmapPageTexelCoordinate(t3.fromTSL(pageDimensions, d.vec2f).$, t3.fromTSL(atlasUv, d.vec2f).$);
  }) as Node<'vec2'>;
  const texelIndex = TSL.ivec2(TSL.int(texelCoordinate.x), TSL.int(texelCoordinate.y));
  const coverage = TSL.textureLoad(resources.page, texelIndex, TSL.int(0)).depth(TSL.int(instance.pageIndex)).r;
  const coverageOpacity = t3.toTSL(() => {
    'use gpu';
    return bitmapPaintCoverageOpacity(t3.fromTSL(coverage, d.f32).$, t3.fromTSL(instance.color, d.vec4f).$);
  }) as Node<'vec2'>;

  return {
    position,
    clipPosition: options.pixelSnapping === true ? pixelSnappedClipPosition() : modelViewProjection,
    atlasUv,
    coverage: coverageOpacity.x,
    color: instance.color.rgb,
    opacity: coverageOpacity.y,
  };
}

function pixelSnappedClipPosition(): Node<'vec4'> {
  const snapped = t3.toTSL(() => {
    'use gpu';
    const clip = t3.modelViewProjection.$;
    return d.vec4f(
      snapClipAxis(clip.x, clip.w, t3.screenSize.$.x),
      snapClipAxis(clip.y, clip.w, t3.screenSize.$.y),
      clip.z,
      clip.w,
    );
  });
  return snapped as Node<'vec4'>;
}
