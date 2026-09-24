/* @workflow {
  "name": "hero:hole-check",
  "summary": "Capture the black-hole finale and verify paper collapse, explosion, blackness, replay, and the play button on WebGPU.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/hero/.cache/hole.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/hole.png"]
} */
import { Text } from '@pmndrs/glyph/three';
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { texture, uv, vec4 } from 'three/tsl';
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
const { Collapse } = (await import(
  new URL('/src/black-hole/traits.ts', location.origin).href
)) as typeof import('../src/black-hole/traits');
const { POP_AT } = (await import(
  new URL('/src/black-hole/content.ts', location.origin).href
)) as typeof import('../src/black-hole/content');
const { Viewport } = (await import(
  new URL('/src/viewport/traits.ts', location.origin).href
)) as typeof import('../src/viewport/traits');
const { uHoleLens } = (await import(
  new URL('/src/black-hole/materials.ts', location.origin).href
)) as typeof import('../src/black-hole/materials');
const { uHoleCollapse } = (await import(
  new URL('/src/black-hole/materials.ts', location.origin).href
)) as typeof import('../src/black-hole/materials');
const { STAR_SYMBOLS, EMBER_SECONDS } = (await import(
  new URL('/src/star-embers/content.ts', location.origin).href
)) as typeof import('../src/star-embers/content');
const { uEmberBloom, uEmberFire } = (await import(
  new URL('/src/star-embers/materials.ts', location.origin).href
)) as typeof import('../src/star-embers/materials');
const { REVEAL_AFTER, REVEAL_SECONDS } = (await import(
  new URL('/src/ui/content.ts', location.origin).href
)) as typeof import('../src/ui/content');
const { Mode } = (await import(
  new URL('/src/director/traits.ts', location.origin).href
)) as typeof import('../src/director/traits');
const { Robot } = (await import(
  new URL('/src/robot/traits.ts', location.origin).href
)) as typeof import('../src/robot/traits');
while (document.documentElement.dataset.heroState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const { actions } = (await import(new URL('/src/actions.ts', location.origin).href)) as typeof import('../src/actions');
const { replayScene: requestReplay, pressScene } = actions(world);
const hole = () => world.get(Collapse)!.hole;
const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The finale check requires WebGPU and the actual post-processing pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

requestReplay();
const scheduler = getScheduler();
let clock = performance.now();
scheduler.step(clock);

while (hole().beat === 'closed') {
  clock += 1000 / 60;
  scheduler.step(clock);
}

const movingSheet = state.scene.getObjectByName('icon-pattern--6')?.parent;

if (movingSheet === null || movingSheet === undefined) throw new Error('Missing the foreground icon sheet');

const initialScroll = movingSheet.position.x;
const moments = [0.65, 1.4, 2, 2.95, POP_AT + 0.12, POP_AT + EMBER_SECONDS] as const;
const tiles = moments.map(() => new RenderTarget(640, 360));
let elapsed = 0;
const stats: { time: number; lit: number; bright: number; total: number }[] = [];

// PassNode updates once per renderer frame. Capture on its native animation callback so every tile samples
// the current scene, even when many deterministic simulation steps ran within one JavaScript task.
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

const litPixels = (pixels: ArrayLike<number>, threshold = 8) => {
  let lit = 0;

  for (let i = 0; i < pixels.length; i += 4)
    if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > threshold) lit++;

  return lit;
};

for (const [index, moment] of moments.entries()) {
  while (elapsed < moment) {
    const delta = Math.min(1 / 60, moment - elapsed);
    elapsed += delta;
    clock += delta * 1000;
    scheduler.step(clock);
  }

  if (index === 0 && Math.abs(movingSheet.position.x - initialScroll) < 0.5) {
    throw new Error('The background stopped scrolling as soon as the hole appeared');
  }

  if (Math.abs(hole().time - moment) > 0.02)
    throw new Error(
      `The scheduler did not advance the finale: ${JSON.stringify({ moment, time: hole().time, clock })}`,
    );

  const tile = tiles[index]!;
  const pixels = await capture(tile);
  stats.push({ time: moment, lit: litPixels(pixels), bright: litPixels(pixels, 160), total: tile.width * tile.height });
  renderer.setRenderTarget(null);
}

// A disabled-collapse control must restore the paper at the same scene state.
world.set(Collapse, { openedAt: clock + 16.667 - 2950 });
scheduler.step(clock + 16.667);
uHoleCollapse.value = 0;
const control = new RenderTarget(640, 360);
const uncollapsed = litPixels(await capture(control));

if (stats[3]!.lit >= uncollapsed * 0.4)
  throw new Error(`Paper failed to collapse: ${JSON.stringify({ stats, uncollapsed })}`);

if (
  stats[4]!.lit < 100 ||
  stats[4]!.bright > stats[4]!.total * 0.08 ||
  stats[4]!.lit > stats[4]!.total * 0.3 ||
  stats[5]!.lit !== 0
)
  throw new Error(`Explosion/black frame failed: ${JSON.stringify(stats)}`);

// The hole bends the frame around it. Its lens off, the pixels near it move back and the far frame holds still.
const bent = await capture(control);
uHoleLens.value = 0;
const straight = await capture(control);
let bentPixels = 0;
let bentFar = 0;

for (let offset = 0; offset < bent.length; offset += 4) {
  const moved =
    Math.max(
      Math.abs(bent[offset]! - straight[offset]!),
      Math.abs(bent[offset + 1]! - straight[offset + 1]!),
      Math.abs(bent[offset + 2]! - straight[offset + 2]!),
    ) > 8;

  if (!moved) continue;

  bentPixels++;
  const pixel = offset / 4;
  const dx = (pixel % control.width) - control.width / 2;
  const dy = Math.floor(pixel / control.width) - control.height / 2;

  if (dx * dx + dy * dy > 300 * 300) bentFar++;
}

if (bentPixels < 500) throw new Error(`The hole did not bend the frame around it: ${bentPixels}`);

if (bentFar > 100) throw new Error(`The hole bent the far frame: ${JSON.stringify({ bentPixels, bentFar })}`);

// The bend follows the hole wherever it is: moved off the centre, its pixels gather about it on screen.
const { width: worldWidth, height: worldHeight } = world.get(Viewport)!;
world.set(Collapse, { x: 3, y: 1.5 });
clock += 33.334;
scheduler.step(clock);
// The view job recomputes the collapse from the hole's clock; the bend is measured on the flat paper.
uHoleCollapse.value = 0;
// Read-back rows run top-down, against the world's y.
const expectedX = control.width / 2 + (3 / worldWidth) * control.width;
const expectedY = control.height / 2 - (1.5 / worldHeight) * control.height;
const movedBent = await capture(control);
const movedLens = uHoleLens.value;
uHoleLens.value = 0;
const movedStraight = await capture(control);
uHoleLens.value = movedLens;
// Its bend gathers about where it is rather than its mirror, which is what an inverted screen axis would give.
let nearHole = 0;
let nearMirror = 0;
let count = 0;

for (let offset = 0; offset < movedBent.length; offset += 4) {
  if (
    Math.max(
      Math.abs(movedBent[offset]! - movedStraight[offset]!),
      Math.abs(movedBent[offset + 1]! - movedStraight[offset + 1]!),
      Math.abs(movedBent[offset + 2]! - movedStraight[offset + 2]!),
    ) <= 8
  )
    continue;

  const pixel = offset / 4;
  const x = pixel % control.width;
  const y = Math.floor(pixel / control.width);
  nearHole += Math.hypot(x - expectedX, y - expectedY);
  nearMirror += Math.hypot(x - (control.width - expectedX), y - (control.height - expectedY));
  count++;
}

const bentAt = { count, hole: Math.round(nearHole / count), mirror: Math.round(nearMirror / count) };

if (count < 500 || bentAt.hole >= bentAt.mirror)
  throw new Error(
    `The bend did not follow the hole off the centre: ${JSON.stringify({ ...bentAt, movedLens, collapse: uHoleCollapse.value, beat: hole().beat, time: hole().time, at: [hole().x, hole().y], expectedX, expectedY })}`,
  );

world.set(Collapse, { x: 0, y: 0 });
clock += 16.667;
scheduler.step(clock);

const burst = state.scene.getObjectByName('star-embers');

if (burst === undefined) throw new Error('Missing the ejected glyphs');

burst.traverse((object) => {
  if (object instanceof Text && !STAR_SYMBOLS.some((symbol) => symbol === object.text)) {
    throw new Error(`Unexpected star glyph: ${object.text}`);
  }
});

world.set(Collapse, { openedAt: clock + 33.334 - (POP_AT + 0.12) * 1000 });
scheduler.step(clock + 33.334);
const emitted = await capture(control);
uEmberFire.value = 0;
const flatStars = await capture(control);
uEmberFire.value = 1;
let burningPixels = 0;

for (let offset = 0; offset < emitted.length; offset += 4) {
  if (
    Math.max(
      Math.abs(emitted[offset]! - flatStars[offset]!),
      Math.abs(emitted[offset + 1]! - flatStars[offset + 1]!),
      Math.abs(emitted[offset + 2]! - flatStars[offset + 2]!),
    ) > 8
  )
    burningPixels++;
}

if (burningPixels < 100) throw new Error(`The burning material has no visible effect: ${burningPixels}`);

burst.visible = false;
const sparksOnly = await capture(control);
burst.visible = true;
let glyphPixels = 0;

for (let offset = 0; offset < emitted.length; offset += 4) {
  if (
    Math.max(
      Math.abs(emitted[offset]! - sparksOnly[offset]!),
      Math.abs(emitted[offset + 1]! - sparksOnly[offset + 1]!),
      Math.abs(emitted[offset + 2]! - sparksOnly[offset + 2]!),
    ) > 8
  )
    glyphPixels++;
}

if (glyphPixels < 100)
  throw new Error(
    `The pop did not emit visible glyphs: ${JSON.stringify({ glyphPixels, stats, emitted: litPixels(emitted), sparksOnly: litPixels(sparksOnly) })}`,
  );

uEmberBloom.value = 0;
const withoutBloom = await capture(control);
uEmberBloom.value = 0.75;
let bloomPixels = 0;

for (let offset = 0; offset < emitted.length; offset += 4) {
  if (
    Math.max(
      emitted[offset]! - withoutBloom[offset]!,
      emitted[offset + 1]! - withoutBloom[offset + 1]!,
      emitted[offset + 2]! - withoutBloom[offset + 2]!,
    ) > 8
  )
    bloomPixels++;
}

if (bloomPixels < 100) throw new Error(`The stars have no visible bloom: ${bloomPixels}`);

world.set(Collapse, { openedAt: clock + 50.001 - (POP_AT + 0.8) * 1000 });
scheduler.step(clock + 50.001);
const embers = await capture(control);
const lingeringStars = litPixels(embers);

if (lingeringStars < 100 || lingeringStars >= litPixels(emitted)) {
  throw new Error(`The stars did not linger and fade: ${lingeringStars}`);
}

uEmberBloom.value = 0;
const embersWithoutBloom = await capture(control);
uEmberBloom.value = 0.75;
let emberGlowPixels = 0;

for (let offset = 0; offset < embers.length; offset += 4) {
  if (
    Math.max(
      embers[offset]! - embersWithoutBloom[offset]!,
      embers[offset + 1]! - embersWithoutBloom[offset + 1]!,
      embers[offset + 2]! - embersWithoutBloom[offset + 2]!,
    ) > 4
  )
    emberGlowPixels++;
}

if (emberGlowPixels < 100) throw new Error(`The fading embers lost their glow: ${emberGlowPixels}`);

requestReplay();
scheduler.step(clock + 66.668);
const replay = litPixels(await capture(control));

if (replay < uncollapsed * 0.85) throw new Error('Replay did not restore the paper');

// Once the embers are out, the play button is the only light on the frame. A press beside it changes nothing;
// a press on it starts play, which restores the paper and puts the robot on the floor.
world.set(Collapse, {
  openedAt: clock + 83.335 - (POP_AT + EMBER_SECONDS + REVEAL_AFTER + REVEAL_SECONDS + 0.2) * 1000,
});
scheduler.step(clock + 83.335);
const buttonPixels = litPixels(await capture(control));

if (buttonPixels < 100 || buttonPixels > control.width * control.height * 0.2)
  throw new Error(`The play button did not light the black frame: ${buttonPixels}`);

pressScene(0.9, 0.9);

if (world.get(Mode)!.kind !== 'sequence') throw new Error('A press beside the play button started play');

pressScene(0.05, -0.05);
scheduler.step(clock + 100.002);
const played = litPixels(await capture(control));
const robot = world.queryFirst(Robot)!.get(Robot)!;

if (world.get(Mode)!.kind !== 'play' || !robot.active || !robot.drive.hasTarget || played < uncollapsed * 0.85)
  throw new Error(`Pressing play did not restart with the robot: ${JSON.stringify({ played, robot: robot.drive })}`);

requestReplay();
scheduler.step(clock + 116.669);

if (world.get(Mode)!.kind !== 'sequence') throw new Error('Space did not return to the sequence');

const sheet = new Scene();
// Letterbox the 16:9 captures within each cell of the 3-by-2 sheet.
const quad = new PlaneGeometry(1, 2 / 3);

const materials = tiles.map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.fragmentNode = vec4(texture(tile.texture, uv().flipY()).rgb, 1);
  const mesh = new Mesh(quad, material);
  mesh.position.set((index % 3) - 1, index < 3 ? 0.5 : -0.5, 0);
  sheet.add(mesh);

  return material;
});

const camera = new OrthographicCamera(-1.5, 1.5, 1, -1, 0.1, 10);
camera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(sheet, camera);
console.log(
  'hero-hole-ready',
  JSON.stringify({
    backend: 'webgpu',
    stats,
    uncollapsed,
    bentPixels,
    bentFar,
    bentAt,
    glyphPixels,
    burningPixels,
    bloomPixels,
    lingeringStars,
    emberGlowPixels,
    replay,
    buttonPixels,
    played,
  }),
);
quad.dispose();
materials.forEach((material) => material.dispose());
tiles.forEach((tile) => tile.dispose());
control.dispose();
