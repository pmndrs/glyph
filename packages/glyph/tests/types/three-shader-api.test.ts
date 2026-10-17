import { mul, texture, vec2, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';

import { defineTextMaterial } from '../../src/three/typegpu.js';
import {
  bitmapShader,
  msdfShader,
  slugShader,
  type TslBitmapInstanceNodes,
  type TslBitmapShaderResources,
  type TslMsdfInstanceNodes,
  type TslMsdfShaderResources,
  type TslSlugInstanceNodes,
  type TslSlugShaderResources,
} from '../../src/shaders/tsl/index.js';
import { bitmapShader as threeBitmapShader } from '../../src/three/typegpu/internal/bitmap-shader.js';

declare const bitmapInstance: TslBitmapInstanceNodes;
declare const bitmapResources: TslBitmapShaderResources;
declare const mtsdfInstance: TslMsdfInstanceNodes;
declare const mtsdfResources: TslMsdfShaderResources;
declare const slugInstance: TslSlugInstanceNodes;
declare const slugResources: TslSlugShaderResources;

const bitmapOutput = bitmapShader(bitmapInstance, bitmapResources);
const threeBitmapOutput = threeBitmapShader(bitmapInstance, bitmapResources);
const mtsdfOutput = msdfShader(mtsdfInstance, mtsdfResources);
const slugOutput = slugShader(slugInstance, slugResources);

const customMaterial = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  const paragraphPosition: Node<'vec3'> = context.paragraphPosition;
  const rendererPosition: Node<'vec3'> = context.position;
  void paragraphPosition;
  void rendererPosition;
  material.depthTest = true;
  if (context.kind === 'glyph' && context.format === 'pmndrs.slug') material.opacityNode = context.shader.opacity;
  if (context.kind === 'decoration') material.colorNode = context.shader.color;
  return material;
});

// Each technique publishes its coverage as a float a custom program may weight or threshold itself.
const bitmapCoverage: Node<'float'> = bitmapOutput.coverage;
const mtsdfOutlineCoverage: Node<'float'> = mtsdfOutput.outlineCoverage;
const slugCoverage: Node<'float'> = slugOutput.coverage;
// Slug integrates wherever the material asks, so bending the letterform is the caller's inverse map.
const slugWarpedCoverage: Node<'float'> = slugOutput.coverageAt(slugOutput.renderCoordinate.mul(0.5));
// @ts-expect-error The coordinate is an em-space vec2; a float cannot address the integral.
slugOutput.coverageAt(slugOutput.coverage);

const warpedMaterial = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'glyph' && context.format === 'pmndrs.slug')
    material.opacityNode = context.shader.coverageAt(context.shader.renderCoordinate.add(0.1));
  return material;
});

declare const image: THREE.Texture;
declare const paragraphInkBounds: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
const paragraphMappedMaterial = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return material;
  const position = context.paragraphPosition;
  const bottom = -(paragraphInkBounds.y + paragraphInkBounds.height);
  const uv = vec2(
    position.x.sub(paragraphInkBounds.x).div(paragraphInkBounds.width),
    position.y.sub(bottom).div(paragraphInkBounds.height),
  );
  material.colorNode = texture(image, uv).rgb.mul(context.shader.color);
  return material;
});

const displacedMaterial = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return material;
  const position = context.position;
  material.positionNode = position.add(vec3(position.y.sin().mul(0.12), 0, 0));
  material.colorNode = context.shader.color.mul(position.x.sin().mul(0.2).add(0.8));
  return material;
});

const material = new THREE.MeshBasicNodeMaterial();
material.positionNode = slugOutput.position;
material.colorNode = mul(slugOutput.color, vec3(1, 0, 0));
material.opacityNode = slugOutput.opacity;

// A composed Bitmap program inherits device-pixel snapping by driving its vertex stage from the published clip
// position; nothing else in the output can supply it, so the seam cannot be missed by construction.
const bitmapMaterial = new THREE.MeshBasicNodeMaterial();
bitmapMaterial.positionNode = bitmapOutput.position;
bitmapMaterial.vertexNode = bitmapOutput.clipPosition;

// @ts-expect-error MTSDF is resolution-independent and deliberately publishes no clip position to snap.
void mtsdfOutput.clipPosition;

// @ts-expect-error Slug is resolution-independent and deliberately publishes no clip position to snap.
void slugOutput.clipPosition;

// @ts-expect-error The canonical colour is a vec3, so a float composition cannot silently consume it.
const wrongColor: Node<'float'> = bitmapOutput.color;

// @ts-expect-error Slug addresses are unsigned integers; a float storage read cannot stand in for one.
slugShader({ ...slugInstance, curveBaseTexel: slugOutput.coverage }, slugResources);

// @ts-expect-error Material factories must return a Three NodeMaterial.
defineTextMaterial(() => ({}));

void bitmapCoverage;
void threeBitmapOutput;
void mtsdfOutlineCoverage;
void slugCoverage;
void slugWarpedCoverage;
void warpedMaterial;
void paragraphMappedMaterial;
void displacedMaterial;
void material;
void bitmapMaterial;
void wrongColor;
void customMaterial;
void mtsdfOutput;
