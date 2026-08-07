import { mul, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';

import {
  bitmapShader,
  mtsdfShader,
  slugShader,
  type ThreeBitmapInstanceNodes,
  type ThreeBitmapShaderResources,
  type ThreeMtsdfInstanceNodes,
  type ThreeMtsdfShaderResources,
  type ThreeSlugInstanceNodes,
  type ThreeSlugShaderResources,
} from '../../src/three.js';

declare const bitmapInstance: ThreeBitmapInstanceNodes;
declare const bitmapResources: ThreeBitmapShaderResources;
declare const mtsdfInstance: ThreeMtsdfInstanceNodes;
declare const mtsdfResources: ThreeMtsdfShaderResources;
declare const slugInstance: ThreeSlugInstanceNodes;
declare const slugResources: ThreeSlugShaderResources;

const bitmapOutput = bitmapShader(bitmapInstance, bitmapResources);
const mtsdfOutput = mtsdfShader(mtsdfInstance, mtsdfResources);
const slugOutput = slugShader(slugInstance, slugResources);

// Each technique publishes its coverage as a float a custom program may weight or threshold itself.
const bitmapCoverage: Node<'float'> = bitmapOutput.coverage;
const mtsdfOutlineCoverage: Node<'float'> = mtsdfOutput.outlineCoverage;
const slugCoverage: Node<'float'> = slugOutput.coverage;

const material = new THREE.MeshBasicNodeMaterial();
material.positionNode = slugOutput.position;
material.colorNode = mul(slugOutput.color, vec3(1, 0, 0));
material.opacityNode = slugOutput.opacity;

// @ts-expect-error The canonical colour is a vec3, so a float composition cannot silently consume it.
const wrongColor: Node<'float'> = bitmapOutput.color;

// @ts-expect-error Slug addresses are unsigned integers; a float storage read cannot stand in for one.
slugShader({ ...slugInstance, curveBaseTexel: slugOutput.coverage }, slugResources);

void bitmapCoverage;
void mtsdfOutlineCoverage;
void slugCoverage;
void material;
void wrongColor;
void mtsdfOutput;
