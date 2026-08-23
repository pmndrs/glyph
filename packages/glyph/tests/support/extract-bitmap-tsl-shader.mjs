import { attribute } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { bitmapShader } from '../../dist/tsl/bitmap-shader.js';

/**
 * Compiles the canonical TSL Bitmap material to shader source without a GPU device.
 *
 * Node builds are pure text generation, so a real renderer over an offscreen canvas
 * stand-in reaches the generated WGSL that a hardware WebGPU run would execute. The
 * instance nodes are plain per-vertex attributes and the coverage page is an unsigned
 * byte data array — the same resource kinds the command-buffer executor binds — so the
 * extracted source is the authoritative statement of what `/tsl` produces for Bitmap.
 *
 * `renderer.hasFeature` is stubbed because it is the only builder input that requires
 * an adapter; Bitmap reads its pages through data-texture texel loads, so no optional
 * filtering feature can change the generated source.
 *
 * @param {{ pixelSnapping: boolean }} options Variant selector for the clip placement.
 * @returns {{ vertex: string, fragment: string }} Generated WGSL per stage.
 */
export function extractBitmapTslShader({ pixelSnapping }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('glyphOrigin', new THREE.Float32BufferAttribute([0, 0], 2));
  geometry.setAttribute('glyphSize', new THREE.Float32BufferAttribute([1, 1], 2));
  geometry.setAttribute('atlasOrigin', new THREE.Float32BufferAttribute([0, 0], 2));
  geometry.setAttribute('atlasExtent', new THREE.Float32BufferAttribute([1, 1], 2));
  geometry.setAttribute('paintColor', new THREE.Float32BufferAttribute([1, 1, 1, 1], 4));

  const page = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  page.format = THREE.RedFormat;
  page.type = THREE.UnsignedByteType;

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
