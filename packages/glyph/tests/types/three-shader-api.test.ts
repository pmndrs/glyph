import { mul, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';

import { defineTextMaterial } from '../../src/three.js';
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
} from '../../src/tsl.js';

declare const bitmapInstance: TslBitmapInstanceNodes;
declare const bitmapResources: TslBitmapShaderResources;
declare const mtsdfInstance: TslMsdfInstanceNodes;
declare const mtsdfResources: TslMsdfShaderResources;
declare const slugInstance: TslSlugInstanceNodes;
declare const slugResources: TslSlugShaderResources;

const bitmapOutput = bitmapShader(bitmapInstance, bitmapResources);
const mtsdfOutput = msdfShader(mtsdfInstance, mtsdfResources);
const slugOutput = slugShader(slugInstance, slugResources);

const customMaterial = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = true;
  if (context.technique === 'pmndrs.slug') material.opacityNode = context.shader.opacity;
  return material;
});

// Each technique publishes its coverage as a float a custom program may weight or threshold itself.
const bitmapCoverage: Node<'float'> = bitmapOutput.coverage;
const mtsdfOutlineCoverage: Node<'float'> = mtsdfOutput.outlineCoverage;
const slugCoverage: Node<'float'> = slugOutput.coverage;

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
void mtsdfOutlineCoverage;
void slugCoverage;
void material;
void bitmapMaterial;
void wrongColor;
void customMaterial;
void mtsdfOutput;
