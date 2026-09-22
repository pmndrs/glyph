/* @workflow {
  "name": "hero:robot",
  "summary": "Pack the Cute Home Robot glTF into the hero's single-file robot.glb, or verify it with --check.",
  "requirements": "The Sketchfab source under apps/hero/assets/cute_home_robot (Git LFS).",
  "writes": "apps/hero/assets/robot.glb"
} */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * The Sketchfab download is a multi-file glTF whose textures are 2048² PNGs: 12 MB for a robot that is a few hundred
 * pixels tall on screen. Vite copies only the file that is imported, so the sibling `.bin` and textures would never
 * reach a build anyway. This packs it into one GLB: the ground disc the model ships with is dropped (the hero has
 * its own floor), the textures are brought down to 1024² WebP, and the animation is resampled.
 */
const SOURCE = new URL('../assets/cute_home_robot/scene.gltf', import.meta.url);
const OUTPUT = new URL('../assets/robot.glb', import.meta.url);
/** The model's own floor: a textured disc under the wheels. */
const FLOOR_NODE = 'Cylinder001';
const TEXTURE_SIZE = 1024;
const TEXTURE_QUALITY = 85;

const check = process.argv.includes('--check');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(fileURLToPath(SOURCE));
const floor = document
  .getRoot()
  .listNodes()
  .find((node) => node.getName() === FLOOR_NODE);

if (floor === undefined) throw new Error(`${FLOOR_NODE} is missing from ${SOURCE.pathname}`);

floor.dispose();
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
    console.error(`${OUTPUT.pathname} is stale; run \`pnpm scripts run hero:robot\` to repack it.`);
    process.exit(1);
  }

  console.log(`${OUTPUT.pathname} is up to date (${packed.byteLength} bytes).`);
} else {
  await writeFile(OUTPUT, packed);
  console.log(`wrote ${OUTPUT.pathname} (${packed.byteLength} bytes)`);
}
