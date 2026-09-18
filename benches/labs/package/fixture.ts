import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as THREE from 'three/webgpu';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) {
  throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed @pmndrs/glyph package');
}

const glyphPackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const threePackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/three.js')).href
)) as typeof import('@pmndrs/glyph/three');

const { bitmap, glyph } = glyphPackage;
const { defineThreeConfig } = threePackage;
const fontBytes = await readFile(new URL('../../fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url));

await glyph.init();
const font = glyph.fontFace(new Blob([new Uint8Array(fontBytes)], { type: 'model/gltf-binary' }), {
  format: bitmap({ strikes: [16] }),
});
await font.load();

const paragraphSource = [
  'Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8-512 px, and punctuation.',
  'Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl shaping candidates.',
].join(' ');
const paragraphText = Array.from({ length: 18 }, () => paragraphSource).join('\n');
let nextHandle = 1;

export function createParagraph(text = paragraphText, width = 600) {
  const root = glyph.handle(
    `labs:package:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: 8192, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const paragraph = root.createText({
    font,
    text,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: width } },
  });
  textGroup.add(paragraph);
  textGroup.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { paragraph, root, textGroup };
}

export function disposeParagraph(created: ReturnType<typeof createParagraph>): void {
  created.textGroup.dispose();
  created.paragraph.dispose();
  created.root.dispose();
}

export function createLabels(count = 100) {
  const root = glyph.handle(
    `labs:labels:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: count * 24, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const scene = new THREE.Scene();
  const labels = Array.from({ length: count }, (_, index) =>
    root.createText({
      font,
      text: `label ${String(index).padStart(3, '0')}`,
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 160 } },
    }),
  );
  textGroup.add(...labels);
  scene.add(textGroup);
  scene.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { labels, root, scene, textGroup };
}

export function disposeLabels(created: ReturnType<typeof createLabels>): void {
  created.textGroup.dispose();
  for (const label of created.labels) label.dispose();
  created.root.dispose();
}

export function createTextBatch(count: number) {
  const root = glyph.handle(
    `labs:batch:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const digits = String(count).length;
  const texts = Array.from({ length: count }, (_, index) =>
    root.createText({
      font,
      text: `alpha ${String(index).padStart(digits, '0')}`,
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 160 } },
    }),
  );
  textGroup.add(...texts);
  textGroup.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { root, textGroup, texts };
}

export function disposeTextBatch(created: ReturnType<typeof createTextBatch>): void {
  created.textGroup.dispose();
  for (const text of created.texts) text.dispose();
  created.root.dispose();
}

export function borrowedGlyphChecksum(labels: ReturnType<typeof createLabels>['labels']): number {
  return labels.reduce(
    (total, label) =>
      total +
      label.withGlyphs((glyphs) => {
        let checksum = glyphs.glyphCount;
        for (let index = 0; index < glyphs.glyphCount; index += 1) {
          const record = glyphs.glyphAt(index);
          checksum += record.stableId + record.glyphId + record.x + record.y + record.advance;
        }
        return checksum;
      }),
    0,
  );
}

export function editedText(iteration: number): string {
  const leading = String.fromCharCode(65 + (iteration % 26));
  return `${leading}${paragraphText.slice(1)}`;
}
