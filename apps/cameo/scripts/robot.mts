/* @workflow {
  "name": "cameo:robot",
  "summary": "Pack the Cute Home Robot glTF into the cameo's single-file robot.glb, or verify it with --check.",
  "requirements": "The Sketchfab source under apps/cameo/assets/cute_home_robot (Git LFS).",
  "writes": "apps/cameo/assets/robot.glb"
} */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * The Sketchfab download is a multi-file glTF whose textures are 2048² PNGs: 12 MB for a robot that is a few hundred
 * pixels tall on screen. Vite copies only the file that is imported, so the sibling `.bin` and textures would never
 * reach a build anyway. This packs it into one GLB: the ground disc the model ships with is dropped (the cameo has
 * its own floor), the textures are brought down to 1024² WebP, and the animation is resampled.
 */
const SOURCE = new URL('../assets/cute_home_robot/scene.gltf', import.meta.url);
const OUTPUT = new URL('../assets/robot.glb', import.meta.url);
/** The model's own floor: a textured disc under the wheels. */
const FLOOR_NODE = 'Cylinder001';
const TEXTURE_SIZE = 1024;
const TEXTURE_QUALITY = 85;
/** How far a track's last keyframe may sit from its first and still count as closing its loop. */
const LOOP_TOLERANCE = 1e-4;

const check = process.argv.includes('--check');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(fileURLToPath(SOURCE));
const floor = document
  .getRoot()
  .listNodes()
  .find((node) => node.getName() === FLOOR_NODE);

if (floor === undefined) throw new Error(`${FLOOR_NODE} is missing from ${SOURCE.pathname}`);

floor.dispose();
closeAnimationLoops(document);
await document.transform(
  prune(),
  dedup(),
  resample(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [TEXTURE_SIZE, TEXTURE_SIZE],
    quality: TEXTURE_QUALITY,
  }),
);
const packed = await io.writeBinary(document);

if (check) {
  const committed = await readFile(OUTPUT).catch(() => undefined);

  if (committed === undefined || Buffer.compare(committed, packed) !== 0) {
    console.error(`${OUTPUT.pathname} is stale; run \`pnpm scripts run cameo:robot\` to repack it.`);
    process.exit(1);
  }

  console.log(`${OUTPUT.pathname} is up to date (${packed.byteLength} bytes).`);
} else {
  await writeFile(OUTPUT, packed);
  console.log(`wrote ${OUTPUT.pathname} (${packed.byteLength} bytes)`);
}

/**
 * The source clip is a one-shot, not a loop. Every track but one ends where it started; `Bone021_010` swings a limb
 * over the first second and settles somewhere else, so playing the clip round jerks that limb back every time it
 * repeats. The cameo plays it on a loop for the whole take, so any track that does not return to its first
 * keyframe is held at the value it settled on instead, which costs a one-off swing and buys a seam that never
 * shows. Tracks that already close are left exactly as they are.
 */
function closeAnimationLoops(model: Document): void {
  for (const animation of model.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      const output = sampler?.getOutput() ?? null;
      const values = output?.getArray() ?? null;

      if (sampler === null || output === null || values === null) continue;

      const stride = output.getElementSize();
      const settled = values.slice(values.length - stride);
      let drift = 0;

      for (let lane = 0; lane < stride; lane++) drift = Math.max(drift, Math.abs(values[lane]! - settled[lane]!));

      if (drift <= LOOP_TOLERANCE) continue;

      const held = values.slice();

      for (let at = 0; at < held.length; at += stride) held.set(settled, at);

      sampler.setOutput(output.clone().setArray(held));
      console.log(
        `held ${channel.getTargetNode()?.getName() ?? '?'}.${String(channel.getTargetPath())} at its settled value ` +
          `(loop drift ${drift.toFixed(3)})`,
      );
    }
  }
}
