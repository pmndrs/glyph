/* @workflow {
  "name": "hero:refraction-check",
  "summary": "Render the real hero on WebGPU and verify stained glass against an untinted control.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/refraction.png and stdout",
  "args": ["--gpu", "--timeout", "120", "--screenshot", ".cache/refraction.png"]
} */
import { _roots } from '@react-three/fiber/webgpu';
import { Mesh, MeshPhysicalNodeMaterial, RenderTarget, WebGPUBackend, WebGPURenderer } from 'three/webgpu';
import { Text } from '@pmndrs/glyph/three';
function glassMesh(): Mesh | undefined {
  const scene = _roots.values().next().value?.store.getState().scene;
  let glass: Mesh | undefined;
  scene?.traverseVisible((object) => {
    if (
      object instanceof Mesh &&
      object.material instanceof MeshPhysicalNodeMaterial &&
      object.material.transmission > 0
    ) {
      glass = object;
    }
  });
  return glass;
}

function featureReady(): boolean {
  const scene = _roots.values().next().value?.store.getState().scene;
  let ready = false;
  scene?.traverseVisible((object) => {
    if (object instanceof Text && object.text.startsWith('SHAPING') && object.style.opacity === 1) {
      ready = object.commitState().status === 'committed';
    }
  });
  return ready;
}

// Fonts, fitted feature text, and the environment become ready independently.
while (
  glassMesh() === undefined ||
  !featureReady() ||
  !_roots.values().next().value?.store.getState().scene.environment
) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
const state = _roots.values().next().value?.store.getState();
const glass = glassMesh();
if (state === undefined || glass === undefined) throw new Error('Hero scene did not mount');
if (!(glass.material instanceof MeshPhysicalNodeMaterial)) throw new Error('Missing physical glass');
const materials = new Set<MeshPhysicalNodeMaterial>();
state.scene.traverseVisible((object) => {
  if (
    object instanceof Mesh &&
    object.material instanceof MeshPhysicalNodeMaterial &&
    object.material.name.startsWith('stained-glass-')
  ) {
    materials.add(object.material);
  }
});
if (new Set([...materials].map((material) => material.name)).size !== 5)
  throw new Error(`Expected five stained glass materials, got ${materials.size}`);
const original = [...materials].map((entry) => ({
  material: entry,
  color: entry.color.clone(),
  attenuation: entry.attenuationColor.clone(),
}));
state.setFrameloop('never');
const { renderer, scene, camera } = state;
if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend)) {
  throw new Error('The refraction check requires the actual WebGPU backend');
}
renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

const target = new RenderTarget(960, 600, { samples: 4 });
const previousTarget = renderer.getRenderTarget();
try {
  await renderer.compileAsync(scene, camera);
  const shader = await renderer.debug.getShaderAsync(scene, camera, glass);
  if (!shader.fragmentShader?.includes('refract(') || !shader.fragmentShader.includes('textureSampleLevel')) {
    throw new Error('Compiled glass shader omitted refraction or explicit mip sampling');
  }

  const capture = async () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
  };
  for (const entry of materials) {
    entry.color.set('#ffffff');
    entry.attenuationColor.set('#ffffff');
  }
  const straight = await capture();
  for (const entry of original) {
    entry.material.color.copy(entry.color);
    entry.material.attenuationColor.copy(entry.attenuation);
  }
  const refracted = await capture();
  const repeated = await capture();
  let changed = 0;
  let outside = 0;
  let unstable = 0;
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const offset = (y * target.width + x) * 4;
      const difference = Math.max(
        Math.abs(straight[offset]! - refracted[offset]!),
        Math.abs(straight[offset + 1]! - refracted[offset + 1]!),
        Math.abs(straight[offset + 2]! - refracted[offset + 2]!),
      );
      if (difference > 8) {
        changed += 1;
        if (y < 90 || y >= target.height - 90) outside += 1;
      }
      for (let channel = 0; channel < 3; channel += 1) {
        if (Math.abs(refracted[offset + channel]! - repeated[offset + channel]!) > 1) unstable += 1;
      }
    }
  }
  if (changed < 1_000 || outside !== 0 || unstable !== 0) {
    throw new Error(`Refraction pixels failed: ${JSON.stringify({ changed, outside, unstable })}`);
  }
  target.setSize(640, 400);
  await capture();
  console.log(
    'hero-refraction-ready',
    JSON.stringify({ backend: 'webgpu', changed, outside, unstable, resized: true }),
  );
} finally {
  for (const entry of original) {
    entry.material.color.copy(entry.color);
    entry.material.attenuationColor.copy(entry.attenuation);
  }
  renderer.setRenderTarget(previousTarget);
  target.dispose();
}
renderer.render(scene, camera);
