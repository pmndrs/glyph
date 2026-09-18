/* @workflow {
  "name": "hero:glass-shadow-check",
  "summary": "Verify the subtle colored fringe projected from the flat glyph shaders on WebGPU.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/glass-shadows.png and stdout",
  "args": ["--gpu", "--timeout", "120", "--screenshot", ".cache/glass-shadows.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { Text } from '@pmndrs/glyph/three';
import { Mesh, MeshPhysicalNodeMaterial, RenderTarget, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

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
while (!ready()) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const state = _roots.values().next().value?.store.getState();
if (state === undefined) throw new Error('Hero did not mount');
state.setFrameloop('never');
const { renderer, scene, camera } = state;
if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend)) {
  throw new Error('Glass shadows must execute on WebGPU');
}
renderer.onDeviceLost = (info) => {
  throw new Error(info.message);
};
const projection = scene.getObjectByName('glass-shadows');
if (!(projection instanceof Mesh)) throw new Error('Missing glass projection');
const glass: MeshPhysicalNodeMaterial[] = [];
const meshes: Mesh[] = [];
scene.traverseVisible((object) => {
  if (
    object instanceof Mesh &&
    object.material instanceof MeshPhysicalNodeMaterial &&
    object.material.name.startsWith('stained-glass-')
  ) {
    meshes.push(object);
    if (!glass.includes(object.material)) glass.push(object.material);
  }
});
if (new Set(glass.map((material) => material.name)).size !== 5)
  throw new Error(`Expected five glass panes, found ${glass.length}`);
const poses = meshes.map((mesh) => ({ position: mesh.position.clone(), matrix: mesh.matrix.clone() }));
const tints = glass.map((material) => material.attenuationColor.clone());
const target = new RenderTarget(960, 600, { samples: 4 });
const previousTarget = renderer.getRenderTarget();
const capture = async () => {
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  return renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
};
function changed(a: ArrayLike<number>, b: ArrayLike<number>) {
  let pixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs(a[i + c]! - b[i + c]!) > 3)) pixels += 1;
  }
  return pixels;
}
try {
  await renderer.compileAsync(scene, camera);
  getScheduler().stepJob('hero-glass-shadows');
  const lit = await capture();
  const repeat = await capture();
  projection.visible = false;
  const plain = await capture();
  projection.visible = true;
  for (const material of glass) material.attenuationColor.set('#ffffff');
  getScheduler().stepJob('hero-glass-shadows');
  glass.forEach((material, i) => material.attenuationColor.copy(tints[i]!));
  const untinted = await capture();
  // Lift the real draw surfaces for the projection, then restore the visible glass before reading pixels.
  // This isolates depth projection from the obvious screen-space movement of the title itself.
  meshes.forEach((mesh) => {
    mesh.position.z += 3;
    mesh.matrix.elements[14] += 3;
  });
  getScheduler().stepJob('hero-glass-shadows');
  meshes.forEach((mesh, i) => {
    mesh.position.copy(poses[i]!.position);
    mesh.matrix.copy(poses[i]!.matrix);
  });
  const lifted = await capture();
  getScheduler().stepJob('hero-glass-shadows');
  const landed = await capture();
  const depthResponse = changed(lit, lifted);
  const settled = changed(lit, landed);
  const effect = changed(lit, plain);
  const tinted = changed(lit, untinted);
  const unstable = changed(lit, repeat);
  if (effect < 500 || tinted < 500 || depthResponse < 500 || settled !== 0 || unstable !== 0) {
    throw new Error(
      `Glass shadows pixels failed ${JSON.stringify({ effect, tinted, depthResponse, settled, unstable })}`,
    );
  }
  target.setSize(640, 400);
  await capture();
  console.log(
    'hero-glass-shadows-ready',
    JSON.stringify({ backend: 'webgpu', effect, tinted, depthResponse, settled, unstable, resized: true }),
  );
} finally {
  meshes.forEach((mesh, i) => {
    mesh.position.copy(poses[i]!.position);
    mesh.matrix.copy(poses[i]!.matrix);
  });
  glass.forEach((material, i) => material.attenuationColor.copy(tints[i]!));
  projection.visible = true;
  renderer.setRenderTarget(previousTarget);
  getScheduler().stepJob('hero-glass-shadows');
}
// Resizing the readback target invalidates frame-scoped transmission textures. Let the renderer advance its
// animation frame before returning to the screen-sized post pipeline.
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
renderer.render(scene, camera);

target.dispose();
