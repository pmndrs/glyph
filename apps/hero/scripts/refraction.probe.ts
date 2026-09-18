/* @workflow {
  "name": "hero:refraction-check",
  "summary": "Render the real hero on WebGPU and verify stained glass against an untinted control.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/refraction.png and stdout",
  "args": ["--gpu", "--timeout", "120", "--screenshot", ".cache/refraction.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { Mesh, MeshPhysicalNodeMaterial, RenderTarget, WebGPUBackend, WebGPURenderer } from 'three/webgpu';
import { Text } from '@pmndrs/glyph/three';
// Vitexec serves this probe from its own URL; resolve application modules from Vite's root.
const { stainedGlassLetters } = (await import(
  /* @vite-ignore */ new URL('/src/materials/ink.ts', location.href).href
)) as typeof import('../src/materials/ink');
const { shockwaves } = (await import(
  /* @vite-ignore */ new URL('/src/scene/shockwave.ts', location.href).href
)) as typeof import('../src/scene/shockwave');

function glassMesh(): Mesh | undefined {
  const scene = _roots.values().next().value?.store.getState().scene;
  let glass: Mesh | undefined;
  scene?.traverse((object) => {
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
  scene?.traverse((object) => {
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
state.scene.traverse((object) => {
  if (
    object instanceof Mesh &&
    object.material instanceof MeshPhysicalNodeMaterial &&
    object.material.name.startsWith('stained-glass-')
  ) {
    materials.add(object.material);
  }
});
if (materials.size !== 5) throw new Error(`Expected five stained glass materials, got ${materials.size}`);
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

// Drive the actual Space handler and animation callback with fixed 10 ms simulation steps.
// stepJob derives delta from the root's last tick, so the fixed timestamp supplies exactly 10 ms each call.
const scheduler = getScheduler();
const baseline = performance.now();
state.advance(baseline);
const previousWave = shockwaves().at(-1)?.id ?? 0;
window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
const arrivals: number[] = [];
let lastWave = previousWave;
for (let milliseconds = 10; milliseconds <= 1250; milliseconds += 10) {
  scheduler.stepJob('hero-title-motion', baseline + 10);
  const waves = shockwaves().filter((wave) => wave.id > lastWave);
  for (const wave of waves) {
    arrivals.push(milliseconds);
    lastWave = wave.id;
  }
  if (milliseconds === 450 && stainedGlassLetters[0]!.depth.value < 13) {
    throw new Error('Space did not lift the title');
  }
  if (milliseconds === 680 && Math.abs(stainedGlassLetters[0]!.angle.value) < 0.01) {
    throw new Error('Landing did not produce a settling jostle');
  }
  if (milliseconds < 650 && stainedGlassLetters.some((pane) => pane.angle.value !== 0 || pane.sway.value !== 0)) {
    throw new Error('Letters moved sideways before impact');
  }
  if (milliseconds === 300) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true }));
  }
}
if (arrivals.length !== 5 || arrivals.some((time, index) => Math.abs(time - (650 + index * 35)) > 10)) {
  throw new Error(`Letter landings were not staggered: ${JSON.stringify(arrivals)}`);
}
if (
  stainedGlassLetters.some(
    (pane) => pane.depth.value !== 0 || pane.height.value !== 0 || pane.angle.value !== 0 || pane.sway.value !== 0,
  )
) {
  throw new Error('Title did not settle back to rest');
}
const shadows: Mesh[] = [];
scene.traverse((object) => {
  if (object instanceof Mesh && !Array.isArray(object.material) && object.material.name.startsWith('glass-shadow-')) {
    shadows.push(object);
  }
});
if (shadows.length !== 5) throw new Error(`Expected five colored shadows, got ${shadows.length}`);

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
  for (const shadow of shadows) shadow.visible = false;
  const withoutShadows = await capture();
  for (const shadow of shadows) shadow.visible = true;
  let shadowPixels = 0;
  for (let offset = 0; offset < refracted.length; offset += 4) {
    if ([0, 1, 2].some((channel) => Math.abs(refracted[offset + channel]! - withoutShadows[offset + channel]!) > 2)) {
      shadowPixels += 1;
    }
  }
  if (shadowPixels < 500) throw new Error(`Soft shadows had no visible effect: ${shadowPixels}`);
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
    JSON.stringify({ backend: 'webgpu', changed, outside, unstable, shadowPixels, arrivals, resized: true }),
  );
} finally {
  for (const shadow of shadows) shadow.visible = true;
  for (const entry of original) {
    entry.material.color.copy(entry.color);
    entry.material.attenuationColor.copy(entry.attenuation);
  }
  renderer.setRenderTarget(previousTarget);
  target.dispose();
}
if (state.renderPipeline !== null) state.renderPipeline.render();
else renderer.render(scene, camera);
