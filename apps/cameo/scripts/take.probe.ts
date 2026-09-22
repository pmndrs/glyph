/* @workflow {
  "name": "cameo:take-check",
  "summary": "Play the cameo on WebGPU, prove the shallow lens holds the robot's face sharp against a floor thrown out of focus, and tile the take's moments.",
  "requirements": "Workspace dependencies, baked cameo assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "apps/cameo/.cache/take.png and stdout",
  "args": ["--gpu", "--timeout", "180", "--screenshot", ".cache/take.png"]
} */
import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { texture, uv, vec4 } from 'three/tsl';
import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGPUBackend,
  WebGPURenderer,
} from 'three/webgpu';

const { world } = (await import(new URL('/src/world.ts', location.origin).href)) as typeof import('../src/world');
const { GREETING, POSTSCRIPT, TAKE_SECONDS } = (await import(
  new URL('/src/robot/content.ts', location.origin).href
)) as typeof import('../src/robot/content');
const { Robot, RobotView } = (await import(
  new URL('/src/robot/traits.ts', location.origin).href
)) as typeof import('../src/robot/traits');
const { CARDS, FACE_PADDING, FACE_WIDTH } = (await import(
  new URL('/src/robot/content.ts', location.origin).href
)) as typeof import('../src/robot/content');
const { IconField } = (await import(
  new URL('/src/icon-field/traits.ts', location.origin).href
)) as typeof import('../src/icon-field/traits');

while (document.documentElement.dataset.cameoState !== 'ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const state = _roots.values().next().value!.store.getState();
state.setFrameloop('never');
const { renderer, renderPipeline, scene, camera } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend) || renderPipeline === null) {
  throw new Error('The take check requires WebGPU and the actual lens pipeline');
}

renderer.onDeviceLost = (info) => {
  throw new Error(`WebGPU device lost: ${info.message}`);
};

const WIDTH = 1280;
const HEIGHT = 720;
const scheduler = getScheduler();
let clock = performance.now();
scheduler.step(clock);

/**
 * Put the take at `seconds` and publish it, so a moment is read at exactly the second it happens. The take's clock
 * is pinned before every step, so stepping several times holds the moment still while each phase of the loop gets
 * its turn: a capture hands the renderer's animation loop back with a wall-clock timestamp, and a step behind that
 * is one the frame-rate limited callbacks decline to run.
 */
const seek = (seconds: number) => {
  for (let frame = 0; frame < 3; frame++) {
    world.query(Robot).updateEach(([robot]) => {
      robot.time = Math.max(0, seconds - 1 / 60);
      robot.startAt = Number.POSITIVE_INFINITY;
    });
    clock = Math.max(clock, performance.now()) + 1000 / 60;
    scheduler.step(clock);
  }
};

/** The lens's own picture, or the same frame drawn straight to compare its sharpness against. */
const capture = async (target: RenderTarget, lens: boolean) => {
  const previousLoop = renderer.getAnimationLoop();

  try {
    await new Promise<void>((resolve, reject) => {
      void renderer
        .setAnimationLoop(() => {
          try {
            renderer.setRenderTarget(target);

            if (lens) renderPipeline.render();
            else renderer.render(scene, camera);

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

interface Box {
  x: number;
  y: number;
  halfX: number;
  halfY: number;
}

/**
 * Detail inside a window, as the mean absolute second difference across neighbouring pixels. A first difference
 * survives defocus, because a soft edge spread over many pixels still leans the same total amount; the second
 * difference does not, because it answers the sharpness of the edge rather than its height. A window holding the
 * hard edges of printed pixels reads high, and the same window thrown out of focus reads near zero.
 */
const detail = (pixels: ArrayLike<number>, box: Box) => {
  const left = Math.max(1, Math.round((box.x - box.halfX) * WIDTH));
  const right = Math.min(WIDTH - 2, Math.round((box.x + box.halfX) * WIDTH));
  const bottom = Math.max(1, Math.round((box.y - box.halfY) * HEIGHT));
  const top = Math.min(HEIGHT - 2, Math.round((box.y + box.halfY) * HEIGHT));
  const luma = (at: number) => pixels[at]! + pixels[at + 1]! + pixels[at + 2]!;
  let total = 0;
  let count = 0;

  for (let row = bottom; row <= top; row++) {
    for (let column = left; column <= right; column++) {
      const at = (row * WIDTH + column) * 4;
      const here = luma(at);
      total += Math.abs(2 * here - luma(at - 4) - luma(at + 4));
      total += Math.abs(2 * here - luma(at - WIDTH * 4) - luma(at + WIDTH * 4));
      count += 2;
    }
  }

  return count === 0 ? 0 : total / count;
};

/**
 * How wide each screenful's ink actually shapes, against the area the display gives it. The type is chosen by
 * hand, so this is what proves the choice: every screenful must fit inside the panel and keep its margin.
 */
const printedWidths = () => {
  const view = world.queryFirst(Robot)!.get(RobotView)!;

  return view.cards.map((card, index) => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const record of card.records) {
      if (record.ink.isEmpty()) continue;

      min = Math.min(min, record.ink.min.x);
      max = Math.max(max, record.ink.max.x);
    }

    // Where the ink lands on the panel, whose middle the printable area is centred on.
    const half = (FACE_WIDTH - FACE_PADDING * 2) / 2;

    return {
      text: CARDS[index]?.text ?? '',
      width: +(max - min).toFixed(4),
      left: +(min + card.centring - half).toFixed(4),
      right: +(max + card.centring - half).toFixed(4),
    };
  });
};

/** Where the robot's display sits in the frame, as a fraction of it, while it is turned to the lens. */
const facePlacement = () => {
  const view = world.queryFirst(Robot)!.get(RobotView);

  if (view?.screen == null || !view.screen.visible) throw new Error('The face is not showing');

  const at = view.screen.getWorldPosition(new Vector3());
  const point = at.clone().project(camera);

  return {
    box: { x: point.x / 2 + 0.5, y: point.y / 2 + 0.5, halfX: 0.05, halfY: 0.045 } satisfies Box,
    at: [+at.x.toFixed(3), +at.y.toFixed(3), +at.z.toFixed(3)],
  };
};

/** Everything found wrong, reported together once the contact sheet has been drawn. */
const problems: string[] = [];

/** A band across the top of the frame: nothing but the icon floor, far past the focal plane. */
const BACKGROUND: Box = { x: 0.5, y: 0.87, halfX: 0.42, halfY: 0.1 };

// Multisampled, because the icon sheets draw their coverage through alpha to coverage: a target without samples
// turns every glyph into a solid square, which would make the control render a different picture of a different
// scene. The captured colour is already encoded, so it is sampled back as such rather than encoded twice.
const tiles = [0, 1, 2, 3].map(() => {
  const target = new RenderTarget(WIDTH, HEIGHT, { samples: 4 });
  target.texture.colorSpace = SRGBColorSpace;

  return target;
});
const moments: Record<string, unknown> = {};

// Rushing in on the diagonal, before it has turned to the lens.
seek(0.95);
await capture(tiles[0]!, true);

// It starts the take outside the picture, which is what lets one take give way to the next unseen.
seek(0);
const entrance = world.queryFirst(Robot)!.get(RobotView)!.root.getWorldPosition(new Vector3()).project(camera);
moments.entrance = { x: +entrance.x.toFixed(3), y: +entrance.y.toFixed(3) };

if (Math.abs(entrance.x) < 1) {
  problems.push(`The robot began the take in frame: ${JSON.stringify(moments.entrance)}`);
}

// Mid greeting: the reading the whole shot is built around.
seek((GREETING[0]!.from + GREETING[0]!.until) / 2);
const greeting = facePlacement();
const face = greeting.box;
const lensed = await capture(tiles[1]!, true);
const straight = await capture(tiles[2]!, false);
const sharpness = {
  faceLensed: detail(lensed, face),
  faceStraight: detail(straight, face),
  floorLensed: detail(lensed, BACKGROUND),
  floorStraight: detail(straight, BACKGROUND),
};
moments.sharpness = sharpness;
moments.greeting = greeting;

// The postscript, delivered after it came back.
seek((POSTSCRIPT[0]!.from + POSTSCRIPT[0]!.until) / 2);
const postscript = facePlacement();
await capture(tiles[3]!, true);
moments.postscript = postscript;

// The face is inside the frame both times it speaks, and well clear of its edges.
for (const [name, placement] of [
  ['greeting', greeting],
  ['postscript', postscript],
] as const) {
  const { box } = placement;

  if (box.x < 0.12 || box.x > 0.88 || box.y < 0.12 || box.y > 0.88) {
    problems.push(`The ${name} was not framed: ${JSON.stringify(placement)}`);
  }
}

// Every screenful fits the panel, with its margin intact on both sides.
const printable = FACE_WIDTH - FACE_PADDING * 2;
const widths = printedWidths();
moments.printed = { printable: +printable.toFixed(4), cards: widths };

const reach = FACE_WIDTH / 2 - FACE_PADDING;

for (const card of widths) {
  if (card.left < -reach || card.right > reach) {
    problems.push(`"${card.text}" runs past the panel's margin of ${String(reach)}: ${JSON.stringify(card)}`);
  }
}

// The floor has a pattern to lose, and the lens loses almost all of it.
if (sharpness.floorStraight < 2) {
  problems.push(`The floor carried no pattern to throw out of focus: ${JSON.stringify(sharpness)}`);
}

if (sharpness.floorLensed > sharpness.floorStraight * 0.6) {
  problems.push(`The floor was not thrown out of focus: ${JSON.stringify(sharpness)}`);
}

if (sharpness.faceLensed < sharpness.faceStraight * 0.6) {
  problems.push(`The lens blurred the face it was focused on: ${JSON.stringify(sharpness)}`);
}

if (sharpness.faceLensed < sharpness.floorLensed * 4) {
  problems.push(`The face did not stand out of the blurred frame: ${JSON.stringify(sharpness)}`);
}

// The floor never stops moving, and every sheet of it carries its own glyph choices.
const sheets = world.query(IconField);

if (sheets.length !== 2) problems.push(`Expected two icon sheets, found ${String(sheets.length)}`);

const before = sheets.map((entity) => entity.get(IconField)!.offset);

for (let step = 0; step < 60; step++) {
  clock = Math.max(clock, performance.now()) + 1000 / 60;
  scheduler.step(clock);
}

const drift = sheets.map((entity, index) => Math.abs(entity.get(IconField)!.offset - before[index]!));
moments.floorDrift = drift;

if (drift.some((amount) => amount < 0.5)) problems.push(`The floor did not drift: ${JSON.stringify(drift)}`);

// It leaves the frame before the take ends, so the next one can be called.
seek(TAKE_SECONDS - 0.05);
const exit = world.queryFirst(Robot)!.get(RobotView)!.root.getWorldPosition(new Vector3()).project(camera);
moments.exit = { x: +exit.x.toFixed(3), y: +exit.y.toFixed(3) };

if (Math.abs(exit.x) < 1) problems.push(`The robot was still in frame at the end: ${JSON.stringify(moments.exit)}`);

// Tile the four moments for the screenshot.
const sheetScene = new Scene();
const quad = new PlaneGeometry(1, HEIGHT / WIDTH);
const materials = tiles.map((tile, index) => {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.fragmentNode = vec4(texture(tile.texture, uv().flipY()).rgb, 1);
  const mesh = new Mesh(quad, material);
  mesh.position.set((index % 2) - 0.5, 0.29 - Math.floor(index / 2) * 0.58, 0);
  sheetScene.add(mesh);

  return material;
});
const sheetCamera = new OrthographicCamera(-1, 1, 0.58, -0.58, 0.1, 10);
sheetCamera.position.z = 1;
renderer.setRenderTarget(null);
renderer.render(sheetScene, sheetCamera);
console.log('cameo-take-ready', JSON.stringify({ backend: 'webgpu', ...moments }));
quad.dispose();
materials.forEach((material) => material.dispose());
tiles.forEach((tile) => tile.dispose());

if (problems.length > 0) throw new Error(problems.join('; '));
