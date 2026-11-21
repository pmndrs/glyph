import * as t3 from '@typegpu/three';
import { d } from 'typegpu';
import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

import {
  MsdfCompositeInput,
  MsdfCoverageInput,
  msdfAtlasCoordinate,
  msdfClampedCoordinates,
  msdfComposite,
  msdfPosition,
} from '../../../shaders/typegpu/msdf-shader.js';
import { msdfCoverageFromDistances, msdfDistances } from '../../../shaders/typegpu/msdf/distance.js';
import type {
  TslMsdfInstanceNodes,
  TslMsdfShaderOutput,
  TslMsdfShaderResources,
} from '../../../shaders/tsl/msdf-shader.js';
import { conditionalShadowSample, perGlyph, scalar, trimmedCell } from '../../../shaders/shared/msdf-quad-tsl.js';
import { decorationPaint } from '../../../shaders/typegpu/decoration-shader.js';

export type {
  TslMsdfInstanceNodes,
  TslMsdfShaderOutput,
  TslMsdfShaderResources,
} from '../../../shaders/tsl/msdf-shader.js';

/** Adapt Three texture sampling and nodes to the canonical TypeGPU MTSDF algorithm. */
export function msdfShader(source: TslMsdfInstanceNodes, resources: TslMsdfShaderResources): TslMsdfShaderOutput {
  const atlasSize = TSL.vec2(scalar(resources.atlasWidth), scalar(resources.atlasHeight));
  const fieldRange = scalar(resources.pixelRange);
  const cell =
    resources.trim === undefined
      ? TSL.uv()
      : trimmedCell(
          source,
          resources.effects ?? { outline: true, shadow: true },
          atlasSize,
          fieldRange,
          resources.trim,
        );
  // Per-glyph values resolve in the vertex stage; fragments read flat varyings instead of instance storage.
  const instance = {
    uvBounds: perGlyph(source.uvBounds),
    fillColor: perGlyph(source.fillColor),
    shadowOffset: perGlyph(source.shadowOffset),
    outlineWidth: perGlyph(source.outlineWidth),
  };
  const outlineColor = perGlyph(
    t3.toTSL(() => {
      'use gpu';
      return decorationPaint(d.vec2u(t3.fromTSL(source.effectColor.x, d.u32).$, 0));
    }) as Node<'vec4'>,
  );
  const shadowColor = perGlyph(
    t3.toTSL(() => {
      'use gpu';
      return decorationPaint(d.vec2u(t3.fromTSL(source.effectColor.y, d.u32).$, 0));
    }) as Node<'vec4'>,
  );
  const position = t3.toTSL(() => {
    'use gpu';
    return msdfPosition(
      t3.fromTSL(source.origin, d.vec2f).$,
      t3.fromTSL(source.size, d.vec2f).$,
      d.vec3f(t3.fromTSL(cell, d.vec2f).$, 0),
    );
  }) as Node<'vec3'>;
  const atlasUv = TSL.varying(
    t3.toTSL(() => {
      'use gpu';
      return msdfAtlasCoordinate(
        t3.fromTSL(source.uvOrigin, d.vec2f).$,
        t3.fromTSL(source.uvSize, d.vec2f).$,
        t3.fromTSL(cell, d.vec2f).$,
      );
    }) as Node<'vec2'>,
  );
  const shadowUv = TSL.sub(atlasUv, instance.shadowOffset);
  const clamped = t3.toTSL(() => {
    'use gpu';
    return msdfClampedCoordinates(
      t3.fromTSL(atlasUv, d.vec2f).$,
      t3.fromTSL(shadowUv, d.vec2f).$,
      t3.fromTSL(instance.uvBounds, d.vec4f).$,
      t3.fromTSL(atlasSize, d.vec2f).$,
    );
  }) as Node<'vec4'>;
  // An integer varying would force flat interpolation; the layer travels as a float and is rounded back.
  const layer = TSL.int(perGlyph(TSL.float(TSL.int(source.pageIndex))).add(0.5));
  const baseSample = TSL.texture(resources.atlas, clamped.xy).depth(layer);
  const shadowSample = conditionalShadowSample(shadowColor.a, resources.atlas, clamped.zw, layer);
  const distances = (
    t3.toTSL(() => {
      'use gpu';
      return msdfDistances(
        t3.fromTSL(baseSample, d.vec4f).$,
        t3.fromTSL(atlasUv, d.vec2f).$,
        t3.fromTSL(atlasSize, d.vec2f).$,
        t3.fromTSL(fieldRange, d.f32).$,
      );
    }) as Node<'vec3'>
  ).toVar();
  const coverage = t3.toTSL(() => {
    'use gpu';
    return msdfCoverageFromDistances(
      MsdfCoverageInput({
        atlasCoordinate: t3.fromTSL(atlasUv, d.vec2f).$,
        shadowCoordinate: t3.fromTSL(shadowUv, d.vec2f).$,
        uvBounds: t3.fromTSL(instance.uvBounds, d.vec4f).$,
        atlasSize: t3.fromTSL(atlasSize, d.vec2f).$,
        pixelRange: t3.fromTSL(fieldRange, d.f32).$,
        baseSample: t3.fromTSL(baseSample, d.vec4f).$,
        shadowSample: t3.fromTSL(shadowSample, d.vec4f).$,
        outlineWidth: t3.fromTSL(instance.outlineWidth, d.f32).$,
      }),
      t3.fromTSL(distances, d.vec3f).$,
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
    fillDistance: distances.x,
    trueDistance: distances.y,
    pixelRange: distances.z,
    fillCoverage: coverage.x,
    outlineCoverage: coverage.y,
    shadowCoverage: coverage.z,
    color: composite.rgb,
    opacity: composite.a,
  };
}
