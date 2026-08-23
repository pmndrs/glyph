import { attribute, uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { slugShader } from '../../dist/tsl/slug-shader.js';

/**
 * Compiles the canonical TSL Slug material to shader source without a GPU device.
 *
 * Node builds are pure text generation, so a real renderer over an offscreen canvas
 * stand-in reaches the generated WGSL that a hardware WebGPU run would execute. The
 * instance fields are plain per-vertex attributes and the page resources are data
 * textures — the same resource kinds the command-buffer executor binds — so the
 * extracted source is the authoritative statement of what `/tsl` produces for Slug.
 *
 * `renderer.hasFeature` is stubbed because it is the only builder input that requires
 * an adapter; Slug reads its tables through integer texel loads, so no optional
 * filtering feature can change the generated source.
 *
 * @param {{ projection?: 'rows' | 'matrix' }} options Projection resource selector.
 * @returns {{ vertex: string, fragment: string }} Generated WGSL per stage.
 */
export function extractSlugTslShader({ projection = 'rows' } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('slugOrigin', new THREE.Float32BufferAttribute([0, 0], 2));
  geometry.setAttribute('slugSize', new THREE.Float32BufferAttribute([1, 1], 2));
  geometry.setAttribute('slugEmOrigin', new THREE.Float32BufferAttribute([0, 0], 2));
  geometry.setAttribute('slugEmSize', new THREE.Float32BufferAttribute([1, 1], 2));
  geometry.setAttribute('slugInverseScale', new THREE.Float32BufferAttribute([1], 1));
  geometry.setAttribute('slugColor', new THREE.Float32BufferAttribute([1, 1, 1, 1], 4));
  geometry.setAttribute('slugBandTransform', new THREE.Float32BufferAttribute([0, 0, 1, 1], 4));
  geometry.setAttribute('slugCurveBase', new THREE.Uint32BufferAttribute([4], 1));
  geometry.setAttribute('slugHorizontalHeaderBase', new THREE.Uint32BufferAttribute([0], 1));
  geometry.setAttribute('slugVerticalHeaderBase', new THREE.Uint32BufferAttribute([1], 1));
  geometry.setAttribute('slugReferenceBase', new THREE.Uint32BufferAttribute([2], 1));
  geometry.setAttribute('slugHorizontalBandCount', new THREE.Uint32BufferAttribute([3], 1));
  geometry.setAttribute('slugVerticalBandCount', new THREE.Uint32BufferAttribute([2], 1));

  const instance = {
    origin: attribute('slugOrigin', 'vec2'),
    size: attribute('slugSize', 'vec2'),
    emOrigin: attribute('slugEmOrigin', 'vec2'),
    emSize: attribute('slugEmSize', 'vec2'),
    inverseScale: attribute('slugInverseScale', 'float'),
    color: attribute('slugColor', 'vec4'),
    bandTransform: attribute('slugBandTransform', 'vec4'),
    curveBaseTexel: attribute('slugCurveBase', 'uint'),
    horizontalHeaderBase: attribute('slugHorizontalHeaderBase', 'uint'),
    verticalHeaderBase: attribute('slugVerticalHeaderBase', 'uint'),
    referenceBase: attribute('slugReferenceBase', 'uint'),
    horizontalBandCount: attribute('slugHorizontalBandCount', 'uint'),
    verticalBandCount: attribute('slugVerticalBandCount', 'uint'),
  };

  const curveTexture = new THREE.DataTexture(new Uint16Array(2 * 2 * 4), 2, 2, THREE.RGBAFormat, THREE.HalfFloatType);
  const headerTexture = new THREE.DataTexture(new Uint32Array(2), 2, 1, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  const referenceTexture = new THREE.DataTexture(
    new Uint32Array(2),
    1,
    2,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  );

  const resources =
    projection === 'rows'
      ? {
          page: {
            curveTexture,
            curveWidth: 2,
            headerTexture,
            headerWidth: 2,
            referenceTexture,
            referenceWidth: 1,
          },
          viewport: uniform(new THREE.Vector2(64, 32)),
          modelViewProjectionRow0: uniform(new THREE.Vector4(1, 0, 0, 0)),
          modelViewProjectionRow1: uniform(new THREE.Vector4(0, 1, 0, 0)),
          modelViewProjectionRow3: uniform(new THREE.Vector4(0, 0, 0, 1)),
        }
      : {
          page: {
            curveTexture,
            curveWidth: 2,
            headerTexture,
            headerWidth: 2,
            referenceTexture,
            referenceWidth: 1,
          },
          viewport: uniform(new THREE.Vector2(64, 32)),
          modelViewProjection: uniform(new THREE.Matrix4()),
        };

  const shader = slugShader(instance, resources);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
  material.positionNode = shader.position;
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
