import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

import {
  bitmapAtlasUv,
  bitmapPaintCoverageOpacity,
  bitmapQuadPosition,
  snapClipAxis,
  snapDecorationClipAxis,
} from '../../../shaders/typegpu/bitmap-shader.js';
import type { SnappedDecorationPoints } from '../../../shaders/tsl/bitmap-shader.js';

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
  // The page is read at Three's resource boundary, exactly as the stable `/tsl` realization reads it: one sample
  // through the texture's own clamp-to-edge filter: linearly by default, and under the handle's `bitmapFilter:
  // 'nearest'` as Three reads a nearest texture (a texel load on WebGPU, a nearest sampler on WebGL2).
  const coverage = TSL.texture(resources.page, atlasUv).depth(instance.pageIndex).r;
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

/** A pixel-snapped text's decoration corner through the canonical `snapDecorationClipAxis`. */
export function pixelSnappedDecorationClipPosition(points: SnappedDecorationPoints): Node<'vec4'> {
  const project = (position: Node<'vec3'>): Node<'vec4'> =>
    TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix.mul(TSL.vec4(position, 1))) as Node<'vec4'>;
  const top = project(points.top);
  const bottom = project(points.bottom);
  const baseline = project(points.baseline);
  const snapped = t3.toTSL(() => {
    'use gpu';
    const clip = t3.modelViewProjection.$;
    const topClip = t3.fromTSL(top, d.vec4f).$;
    const bottomClip = t3.fromTSL(bottom, d.vec4f).$;
    const baselineClip = t3.fromTSL(baseline, d.vec4f).$;
    return d.vec4f(
      snapClipAxis(clip.x, clip.w, t3.screenSize.$.x),
      snapDecorationClipAxis(
        topClip.yw,
        bottomClip.yw,
        baselineClip.yw,
        t3.fromTSL(points.bottomCorner, d.f32).$,
        clip.w,
        t3.screenSize.$.y,
      ),
      clip.z,
      clip.w,
    );
  });
  return snapped as Node<'vec4'>;
}
