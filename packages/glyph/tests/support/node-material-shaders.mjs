import * as THREE from 'three/webgpu';

/**
 * Compile one node material to shader source without a GPU device.
 *
 * The Slug fill crosses the TypeGPU/TSL boundary many times per fragment, and the
 * failure modes there — re-entrant TypeGPU resolution, a boundary variable colliding
 * with a core function, a `std` call with no equivalent in the target language — only
 * appear once Three.js generates shader source. Node builds are pure text generation,
 * so a real renderer over an offscreen canvas stand-in reaches them without a device.
 *
 * Both backends are compiled because the TypeGPU bridge emits WGSL for WebGPU and
 * GLSL for WebGL2, and a core function can be valid in one and absent in the other.
 */
export function compileNodeMaterial(mesh, { backend = 'webgpu', scene, camera } = {}) {
  const renderer = uninitializedRenderer(backend);
  const NodeBuilder = backend === 'webgpu' ? THREE.WGSLNodeBuilder : THREE.GLSLNodeBuilder;
  const builder = new NodeBuilder(mesh, renderer);
  builder.scene = scene ?? new THREE.Scene();
  builder.camera = camera ?? new THREE.Camera();
  builder.material = mesh.material;
  builder.geometry = mesh.geometry;
  builder.build();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** Compile against both supported backends, keyed by backend name. */
export function compileNodeMaterialBackends(mesh, options) {
  return {
    webgpu: compileNodeMaterial(mesh, { ...options, backend: 'webgpu' }),
    webgl2: compileNodeMaterial(mesh, { ...options, backend: 'webgl2' }),
  };
}

function uninitializedRenderer(backend) {
  const renderer = new THREE.WebGPURenderer({
    canvas: offscreenCanvasStandIn(),
    antialias: false,
    forceWebGL: backend === 'webgl2',
  });
  // `hasFeature` is the only builder input that requires an adapter. Slug reads its
  // pages with `textureLoad` through nearest sampling, so no optional filtering
  // feature can change the generated source; the conservative answer is `false`.
  renderer.hasFeature = () => false;
  return renderer;
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
