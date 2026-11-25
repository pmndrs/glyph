import { attribute } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { atlasTextureArray } from '../../dist/three/internal/portable-resource.js';
import { bitmapShader as typegpuBitmapShader } from '../../dist/three/typegpu/internal/bitmap-shader.js';

/**
 * Compiles a Three Bitmap realization (`/three/typegpu` unless another is given) to WGSL without a GPU device. The page
 * is the texture the renderer itself builds, filters included: Three compiles a nearest-filtered page to a texel load
 * and a linear one to a sample, so a stand-in with other filters would pin a program no draw uses. `renderer.hasFeature`
 * is stubbed because sampling an 8-bit page depends on no optional feature.
 */
export function extractBitmapTslShader({ pixelSnapping, bitmapShader = typegpuBitmapShader }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('glyphOrigin', new THREE.Float32BufferAttribute([0, 0], 2));
  geometry.setAttribute('glyphSize', new THREE.Float32BufferAttribute([1, 1], 2));
  geometry.setAttribute('atlasOrigin', new THREE.Float32BufferAttribute([0, 0], 2));
  geometry.setAttribute('atlasExtent', new THREE.Float32BufferAttribute([1, 1], 2));
  geometry.setAttribute('paintColor', new THREE.Float32BufferAttribute([1, 1, 1, 1], 4));

  const page = atlasTextureArray(new Uint8Array(4), 2, 2, 1, THREE.RedFormat);

  const shader = bitmapShader(
    {
      origin: attribute('glyphOrigin', 'vec2'),
      size: attribute('glyphSize', 'vec2'),
      uvOrigin: attribute('atlasOrigin', 'vec2'),
      uvSize: attribute('atlasExtent', 'vec2'),
      color: attribute('paintColor', 'vec4'),
      pageIndex: attribute('pageIndex', 'uint'),
    },
    { page },
    { pixelSnapping },
  );
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
  material.positionNode = shader.position;
  material.vertexNode = shader.clipPosition;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;

  const renderer = new THREE.WebGPURenderer({
    canvas: offscreenCanvasStandIn(),
    antialias: false,
  });
  renderer.hasFeature = () => false;
  const builder = new THREE.WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.Camera();
  builder.build();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function offscreenCanvasStandIn() {
  return {
    style: {},
    width: 1,
    height: 1,
    addEventListener() {},
    removeEventListener() {},
    getContext: () => null,
  };
}
