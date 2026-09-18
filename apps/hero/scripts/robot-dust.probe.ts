/* @workflow {
  "name": "hero:robot-dust-check",
  "summary": "Verify the robot's moving glyph dust and height fade against hidden controls on WebGPU.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/robot-dust.png and stdout",
  "args": ["--gpu", "--timeout", "120", "--screenshot", ".cache/robot-dust.png"]
} */
import { _roots } from '@react-three/fiber/webgpu';
import { type Object3D, RenderTarget, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

function trail(): Object3D | undefined {
  return _roots.values().next().value?.store.getState().scene?.getObjectByName('robot-glyph-dust');
}

function visibleParticles(): Object3D[] {
  return (
    trail()?.children.filter(
      (object) =>
        object.name === 'robot-dust-particle' &&
        object.visible &&
        Math.abs(object.position.x) < 4 &&
        Math.abs(object.position.y) < 3,
    ) ?? []
  );
}

// Wait for visible dust from the real drive-in.
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
while (visibleParticles().length < 12) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
const state = _roots.values().next().value?.store.getState();
const layer = trail();
if (state === undefined || layer === undefined) throw new Error('Robot dust did not mount');
state.setFrameloop('never');
const { renderer, scene, camera } = state;
if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend)) {
  throw new Error('The robot dust check requires the actual WebGPU backend');
}
renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

const particles = layer.children.filter((object) => object.name === 'robot-dust-particle');
const heights = particles.map((object) => object.position.z);
const target = new RenderTarget(960, 600, { samples: 4 });
const previousTarget = renderer.getRenderTarget();
try {
  await renderer.compileAsync(scene, camera);
  const capture = async () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
  };
  const shown = await capture();
  layer.visible = false;
  const hidden = await capture();
  layer.visible = true;
  for (const particle of particles) particle.position.z = 0.93;
  const faded = await capture();
  let changed = 0;
  let remaining = 0;
  for (let offset = 0; offset < shown.length; offset += 4) {
    const difference = Math.max(
      Math.abs(shown[offset]! - hidden[offset]!),
      Math.abs(shown[offset + 1]! - hidden[offset + 1]!),
      Math.abs(shown[offset + 2]! - hidden[offset + 2]!),
    );
    if (difference > 4) changed += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(faded[offset + channel]! - hidden[offset + channel]!) > 1) remaining += 1;
    }
  }
  if (changed < 40 || remaining !== 0) {
    throw new Error(`Robot dust pixels failed: ${JSON.stringify({ changed, remaining })}`);
  }
  console.log(
    'hero-robot-dust-ready',
    JSON.stringify({ backend: 'webgpu', changed, remaining, pool: particles.length }),
  );
} finally {
  layer.visible = true;
  particles.forEach((particle, index) => {
    particle.position.z = heights[index]!;
  });
  renderer.setRenderTarget(previousTarget);
  target.dispose();
}
renderer.render(scene, camera);
