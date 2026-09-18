/* @workflow {
  "name": "hero:glass-shadow-buffers",
  "summary": "Tile the glass shadow's intermediate buffers on WebGPU: capture, lens normals, heights, and caustics.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/glass-shadow-buffers.png and stdout",
  "args": ["--gpu", "--timeout", "120", "--screenshot", ".cache/glass-shadow-buffers.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { Text } from '@pmndrs/glyph/three';
import { float, texture, vec4 } from 'three/tsl';
import {
  Mesh,
  MeshBasicNodeMaterial,
  type OrthographicCamera,
  OrthographicCamera as DebugCamera,
  PlaneGeometry,
  type RenderTarget,
  Scene,
  WebGPUBackend,
  WebGPURenderer,
} from 'three/webgpu';

interface Buffers {
  readonly source: RenderTarget;
  readonly caustic: RenderTarget;
  readonly causticScene: Scene;
  readonly lightCamera: OrthographicCamera;
  readonly receiver: Mesh;
}

function ready() {
  const scene = _roots.values().next().value?.store.getState().scene;
  let feature = false;

  scene?.traverse((object) => {
    if (object instanceof Text && object.text.startsWith('SHAPING') && object.style.opacity === 1) {
      feature = object.commitState().status === 'committed';
    }
  });

  return feature && scene?.environment && scene.getObjectByName('glass-shadows');
}

while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

while (!ready()) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const state = _roots.values().next().value?.store.getState();

if (state === undefined) throw new Error('Hero did not mount');

state.setFrameloop('never');
const { renderer, scene, camera } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend)) {
  throw new Error('Glass shadow buffers must execute on WebGPU');
}

const buffers = (globalThis as { heroGlassShadows?: Buffers }).heroGlassShadows;

if (buffers === undefined) throw new Error('Missing the glass shadow development handle');

await renderer.compileAsync(scene, camera);
getScheduler().stepJob('hero-glass-shadows');
renderer.render(scene, camera);

// One quadrant each: the capture's transmitted tint, its lens normals, the capture four mip levels down, and the
// caustics.
const [output, distance, normal] = buffers.source.textures;

if (output === undefined || distance === undefined || normal === undefined) throw new Error('Missing attachments');

const tiles = [
  { at: [-0.5, 0.5], node: vec4(texture(output).rgb, 1) },
  { at: [0.5, 0.5], node: vec4(texture(normal).xy.div(texture(output).a.max(0.0001)).mul(2).add(0.5), 0, 1) },
  { at: [-0.5, -0.5], node: vec4(texture(output).level(float(4)).rgb, 1) },
  { at: [0.5, -0.5], node: vec4(texture(buffers.caustic.texture).rgb.mul(0.5), 1) },
];
const debugScene = new Scene();
const quad = new PlaneGeometry(1, 1);

const materials = tiles.map(({ at, node }) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.fragmentNode = node;
  const mesh = new Mesh(quad, material);
  mesh.position.set(at[0] ?? 0, at[1] ?? 0, 0);
  debugScene.add(mesh);

  return material;
});

const debugCamera = new DebugCamera(-1, 1, 1, -1, 0.1, 10);
debugCamera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(debugScene, debugCamera);

const grid = buffers.causticScene.children[0];

if (!(grid instanceof Mesh)) throw new Error('Missing caustic grid');

const shader = await renderer.debug.getShaderAsync(buffers.causticScene, buffers.lightCamera, grid);

if (shader.vertexShader === null || shader.fragmentShader === null) throw new Error('Caustic grid did not compile');

const vertexSamples = (shader.vertexShader.match(/textureSampleLevel/g) ?? []).length;
const fragmentDerivatives = (shader.fragmentShader.match(/dpd[xy]/g) ?? []).length;
console.log(
  'hero-glass-shadow-buffers-ready',
  JSON.stringify({ backend: 'webgpu', vertexSamples, fragmentDerivatives, reach: buffers.receiver.visible }),
);
console.log(shader.vertexShader.slice(0, 6000));

quad.dispose();

for (const material of materials) material.dispose();
