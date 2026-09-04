import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

import {
  MsdfCompositeInput,
  MsdfCoverageInput,
  msdfAtlasCoordinate,
  msdfClampedCoordinates,
  msdfComposite,
  msdfCoverage,
  msdfPosition,
} from '../typegpu/msdf-shader.js';
import { decorationPaint } from '../typegpu/decoration-shader.js';

export interface TslMsdfInstanceNodes {
  readonly origin: Node<'vec2'>;
  readonly size: Node<'vec2'>;
  readonly uvOrigin: Node<'vec2'>;
  readonly uvSize: Node<'vec2'>;
  readonly uvBounds: Node<'vec4'>;
  readonly fillColor: Node<'vec4'>;
  /** Packed little-endian sRGB outline and shadow colors from the technique's `effectColor` buffer. */
  readonly effectColor: Node<'uvec2'>;
  readonly shadowOffset: Node<'vec2'>;
  readonly outlineWidth: Node<'float'>;
  readonly pageIndex: Node<'float'>;
}

export interface TslMsdfShaderResources {
  readonly atlas: Texture;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly pixelRange: number;
}

export interface TslMsdfShaderOutput {
  readonly position: Node<'vec3'>;
  readonly atlasUv: Node<'vec2'>;
  readonly fillCoverage: Node<'float'>;
  readonly outlineCoverage: Node<'float'>;
  readonly shadowCoverage: Node<'float'>;
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/** Adapt Three texture sampling and nodes to the canonical TypeGPU MTSDF algorithm. */
export function msdfShader(instance: TslMsdfInstanceNodes, resources: TslMsdfShaderResources): TslMsdfShaderOutput {
  const outlineColor = t3.toTSL(() => {
    'use gpu';
    return decorationPaint(d.vec2u(t3.fromTSL(instance.effectColor.x, d.u32).$, 0));
  }) as Node<'vec4'>;
  const shadowColor = t3.toTSL(() => {
    'use gpu';
    return decorationPaint(d.vec2u(t3.fromTSL(instance.effectColor.y, d.u32).$, 0));
  }) as Node<'vec4'>;
  const position = t3.toTSL(() => {
    'use gpu';
    return msdfPosition(
      t3.fromTSL(instance.origin, d.vec2f).$,
      t3.fromTSL(instance.size, d.vec2f).$,
      t3.positionLocal.$,
    );
  }) as Node<'vec3'>;
  const atlasUv = t3.toTSL(() => {
    'use gpu';
    return msdfAtlasCoordinate(
      t3.fromTSL(instance.uvOrigin, d.vec2f).$,
      t3.fromTSL(instance.uvSize, d.vec2f).$,
      t3.uv().$,
    );
  }) as Node<'vec2'>;
  const shadowUv = TSL.sub(atlasUv, instance.shadowOffset);
  const atlasSize = TSL.vec2(resources.atlasWidth, resources.atlasHeight);
  const clamped = t3.toTSL(() => {
    'use gpu';
    return msdfClampedCoordinates(
      t3.fromTSL(atlasUv, d.vec2f).$,
      t3.fromTSL(shadowUv, d.vec2f).$,
      t3.fromTSL(instance.uvBounds, d.vec4f).$,
      d.vec2f(resources.atlasWidth, resources.atlasHeight),
    );
  }) as Node<'vec4'>;
  const layer = TSL.int(instance.pageIndex);
  const baseSample = TSL.texture(resources.atlas, clamped.xy).depth(layer);
  const shadowSample = TSL.texture(resources.atlas, clamped.zw).depth(layer);
  const coverage = t3.toTSL(() => {
    'use gpu';
    return msdfCoverage(
      MsdfCoverageInput({
        atlasCoordinate: t3.fromTSL(atlasUv, d.vec2f).$,
        shadowCoordinate: t3.fromTSL(shadowUv, d.vec2f).$,
        uvBounds: t3.fromTSL(instance.uvBounds, d.vec4f).$,
        atlasSize: t3.fromTSL(atlasSize, d.vec2f).$,
        pixelRange: resources.pixelRange,
        baseSample: t3.fromTSL(baseSample, d.vec4f).$,
        shadowSample: t3.fromTSL(shadowSample, d.vec4f).$,
        outlineWidth: t3.fromTSL(instance.outlineWidth, d.f32).$,
      }),
    );
  }) as Node<'vec3'>;
  const composite = t3.toTSL(() => {
    'use gpu';
    return msdfComposite(
      MsdfCompositeInput({
        coverage: t3.fromTSL(coverage, d.vec3f).$,
        fillColor: t3.fromTSL(instance.fillColor, d.vec4f).$,
        outlineColor: t3.fromTSL(outlineColor, d.vec4f).$,
        shadowColor: t3.fromTSL(shadowColor, d.vec4f).$,
      }),
    );
  }) as Node<'vec4'>;
  return {
    position,
    atlasUv,
    fillCoverage: coverage.x,
    outlineCoverage: coverage.y,
    shadowCoverage: coverage.z,
    color: composite.rgb,
    opacity: composite.a,
  };
}
