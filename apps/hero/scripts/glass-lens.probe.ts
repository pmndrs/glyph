/* @workflow {
  "name": "hero:glass-lens-check",
  "summary": "Hold one title letter over another on WebGPU and verify glass bends the glass beneath it, and only there.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/glass-lens.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/glass-lens.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { texture, uv, vec2, vec4 } from 'three/tsl';
import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  WebGPUBackend,
  WebGPURenderer,
} from 'three/webgpu';

const { world } = (await import(new URL('/src/world.ts', location.origin).href)) as typeof import('../src/world');
const { Title, TitleView } = (await import(
  new URL('/src/letters/traits.ts', location.origin).href
)) as typeof import('../src/letters/traits');
const { uLens } = (await import(
  new URL('/src/letters/lens.tsx', location.origin).href
)) as typeof import('../src/letters/lens');
const { Body } = (await import(
  new URL('/src/physics/traits.ts', location.origin).href
)) as typeof import('../src/physics/traits');
const { Viewport } = (await import(
  new URL('/src/hero/traits.ts', location.origin).href
)) as typeof import('../src/hero/traits');
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const { replayHero: requestReplay, holdBody } = actions(world);
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The glass lens check requires WebGPU and the actual post-processing pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

requestReplay();
const scheduler = getScheduler();
let clock = performance.now();
const step = (frames: number) => {
  for (let frame = 0; frame < frames; frame++) {
    clock += 1000 / 60;
    scheduler.step(clock);
  }
};
const title = () => world.queryFirst(Title)!.get(Title)!;

// The title smashed down and at rest on the floor.
while (title().bodies === undefined || title().bodies!.replays === 0 || title().bodies!.lifting) step(1);

step(90);

const capture = async (target: RenderTarget) => {
  const previousLoop = renderer.getAnimationLoop();

  try {
    await new Promise<void>((resolve, reject) => {
      void renderer
        .setAnimationLoop(() => {
          try {
            renderer.setRenderTarget(target);
            renderPipeline.render();
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .catch(reject);
    });

    return await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
  } finally {
    await renderer.setAnimationLoop(previousLoop);
    renderer.setRenderTarget(null);
  }
};

const WIDTH = 1280;
const HEIGHT = 720;
const tiles = [0, 1, 2].map(() => new RenderTarget(WIDTH, HEIGHT));

/** Pixels where two captures differ by more than a hair in any channel. */
const differing = (a: ArrayLike<number>, b: ArrayLike<number>): Uint8Array => {
  const out = new Uint8Array(WIDTH * HEIGHT);

  for (let pixel = 0; pixel < out.length; pixel++) {
    const at = pixel * 4;

    if (Math.max(Math.abs(a[at]! - b[at]!), Math.abs(a[at + 1]! - b[at + 1]!), Math.abs(a[at + 2]! - b[at + 2]!)) > 8)
      out[pixel] = 1;
  }

  return out;
};

/** Grow a mask by `radius` pixels each way, rows then columns, through running sums. */
const dilated = (mask: Uint8Array, radius: number): Uint8Array => {
  const spread = (input: Uint8Array, length: number, count: number, stride: number, jump: number) => {
    const output = new Uint8Array(input.length);
    const sums = new Float64Array(length + 1);

    for (let line = 0; line < count; line++) {
      const base = line * stride;

      for (let index = 0; index < length; index++) sums[index + 1] = sums[index]! + input[base + index * jump]!;

      for (let index = 0; index < length; index++) {
        const from = Math.max(0, index - radius);
        const to = Math.min(length, index + radius + 1);

        if (sums[to]! - sums[from]! > 0) output[base + index * jump] = 1;
      }
    }

    return output;
  };

  return spread(spread(mask, WIDTH, HEIGHT, WIDTH, 1), HEIGHT, WIDTH, 1, WIDTH);
};

const count = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);

// At rest no glass lies over glass: the lens changes nothing.
uLens.value = 1;
const restOn = await capture(tiles[0]!);
uLens.value = 0;
const restOff = await capture(tiles[1]!);
const restChanged = count(differing(restOn, restOff));

if (restChanged > 20) throw new Error(`The lens changed the title with no glass over glass: ${restChanged}`);

// One letter held over another, a slab above it. Both are held: a body placed into a loose one would punt it.
const { pieces } = title().bodies!;
const under = [...pieces[0]!.entity.get(Body)!.position] as [number, number, number];
holdBody(pieces[0]!.entity, { x: under[0], y: under[1], z: under[2], yaw: 0 });
holdBody(pieces[1]!.entity, { x: under[0], y: under[1], z: under[2] + 1.2, yaw: 0 });
step(3);
uLens.value = 1;
const lensOn = await capture(tiles[0]!);
uLens.value = 0;
const lensOff = await capture(tiles[1]!);
const draws = world.queryFirst(Title)!.get(TitleView)!;
draws.glyphs.visible = false;
const hidden = await capture(tiles[2]!);
draws.glyphs.visible = true;
uLens.value = 1;
const changed = differing(lensOn, lensOff);
const letters = differing(lensOff, hidden);
const glass = dilated(letters, 48);
let outside = 0;

for (let pixel = 0; pixel < changed.length; pixel++) if (changed[pixel] === 1 && glass[pixel] === 0) outside++;

const changedCount = count(changed);

if (changedCount < 150) throw new Error(`Glass over glass did not bend the glass beneath it: ${changedCount}`);

if (outside > Math.max(5, changedCount * 0.01))
  throw new Error(`The lens bent pixels away from any glass: ${JSON.stringify({ changedCount, outside })}`);

// Tile the lens on and off, and a close look at the overlap, for the screenshot.
const hovered = await capture(tiles[2]!);
const sheet = new Scene();
const quad = new PlaneGeometry(1, 9 / 16);
const { width, height } = world.get(Viewport)!;
const centre = vec2(0.5 + under[0] / width, 0.5 + under[1] / height);
const materials = [tiles[0]!, tiles[1]!].map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.fragmentNode = vec4(texture(tile.texture, uv().flipY()).rgb, 1);
  const mesh = new Mesh(quad, material);
  mesh.position.set(index - 0.5, 0.35, 0);
  sheet.add(mesh);

  return material;
});
const closeUp = new MeshBasicNodeMaterial({ toneMapped: false });
closeUp.fragmentNode = vec4(
  texture(
    tiles[2]!.texture,
    uv()
      .sub(0.5)
      .mul(vec2(0.22, 0.22 * (16 / 9)))
      .add(centre)
      .flipY(),
  ).rgb,
  1,
);
const closeUpMesh = new Mesh(new PlaneGeometry(1.1, 1.1), closeUp);
closeUpMesh.position.set(0, -0.45, 0);
sheet.add(closeUpMesh);
const camera = new OrthographicCamera(-1.5, 1.5, 1, -1, 0.1, 10);
camera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(sheet, camera);
console.log(
  'hero-glass-lens-ready',
  JSON.stringify({ backend: 'webgpu', restChanged, changedCount, outside, hovered: hovered.length }),
);
quad.dispose();
closeUpMesh.geometry.dispose();
closeUp.dispose();
materials.forEach((material) => material.dispose());
tiles.forEach((tile) => tile.dispose());
