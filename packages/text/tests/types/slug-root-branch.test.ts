import * as THREE from 'three/webgpu'
import { bool, uint, vec2, vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'

import { slugRender, type SlugShaderPage } from '../../src/internal/slug-shaders/slug-render.js'

const page: SlugShaderPage = {
  curveTexture: new THREE.DataTexture(),
  curveWidth: 1,
  headerTexture: new THREE.DataTexture(),
  headerWidth: 1,
  referenceTexture: new THREE.DataTexture(),
  referenceWidth: 1,
}

const coverage: Node<'float'> = slugRender(
  page,
  {
    curveBaseTexel: uint(0),
    horizontalHeaderBase: uint(0),
    verticalHeaderBase: uint(0),
    referenceBase: uint(0),
    horizontalBandCount: uint(1),
    verticalBandCount: uint(1),
    bandTransform: vec4(1, 1, 0, 0),
  },
  vec2(0, 0),
  {
    evenOdd: bool(false),
    weightBoost: bool(false),
    rootContributionVariant: 'structural-branch',
  },
)

void coverage
